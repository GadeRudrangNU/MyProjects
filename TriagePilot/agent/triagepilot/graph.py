import re
import time
from dataclasses import dataclass, field
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph
from pydantic import ValidationError

from .classifier import TicketClassifier
from .config import Settings
from .kb import KnowledgeBase
from .llm import CATEGORY_HELP, LlmUnavailable, StructuredLlm
from .pii import contains_pii, scrub
from .schemas import (
    ASSIGNMENT_GROUPS,
    CATEGORIES,
    Article,
    LlmCategoryChoice,
    LlmReply,
    SimilarIncident,
    StepTrace,
    TriageRequest,
    TriageResult,
)

KB_REF = re.compile(r"\bKB\d{4,}\b")
LEAKED_FIELD = re.compile(r"\s*\(?\bcited[_ ]articles?\b.*$", re.IGNORECASE | re.DOTALL)


def clean_reply(text: str) -> str:
    return LEAKED_FIELD.sub("", text).strip()
MAX_PASSES = 2

DECIDE_SYSTEM = (
    "You are an IT service desk triage assistant. Choose the single best category for the ticket. "
    "You may only choose from the candidate list you are given. Use the similar past tickets as evidence. "
    "Category meanings:\n" + CATEGORY_HELP + "\nAnswer with JSON only."
)
DRAFT_SYSTEM = (
    "You write the first reply to an employee who opened an IT ticket. Use only facts from the knowledge articles provided. "
    "If no article helps, say the request has been passed to the right team and ask for nothing sensitive. "
    "Write the reply as plain sentences, under 110 words, polite and direct. Mention an article by its id, exactly as written in the square brackets, when you use it, "
    "and list the ids you relied on in cited_articles. Never invent article ids, links or steps. "
    "Never put field names or JSON inside the reply. Never include emails, phone numbers or IP addresses. Answer with JSON only."
)


@dataclass
class Deps:
    settings: Settings
    classifier: TicketClassifier
    embedder: Any
    store: Any
    kb: KnowledgeBase
    llm: StructuredLlm
    sn: Any = None
    known_groups: set[str] | None = None


@dataclass
class Decision:
    path: str
    category: str
    confidence: float
    reasoning: str
    errors: list[str] = field(default_factory=list)
    llm_down: bool = False


def choose_category(deps: Deps, text: str, top3: list[tuple[str, float]], similar: list[SimilarIncident], feedback: list[str] | None = None) -> Decision:
    """Fast path when the classifier is sure; otherwise the LLM picks among the classifier's top three."""
    top_cat, top_p = top3[0]
    if top_p >= deps.settings.fast_path_threshold:
        return Decision("fast", top_cat, top_p, f"Classifier is {top_p:.0%} sure this is {top_cat}.")
    candidates = [c for c, _ in top3]
    lines = "\n".join(f"- {c} (classifier probability {p:.2f})" for c, p in top3)
    evidence = "\n".join(f"- [{x.category}] {x.text}" for x in similar) or "- none"
    user = f"Ticket:\n{text[:1500]}\n\nCandidate categories:\n{lines}\n\nSimilar past tickets and the category they ended up in:\n{evidence}\n"
    if feedback:
        user += "\nYour previous answer was rejected: " + "; ".join(feedback)
    try:
        choice = deps.llm.run("decide", DECIDE_SYSTEM, user, LlmCategoryChoice)
    except (ValidationError, ValueError) as exc:
        return Decision("llm", top_cat, top_p, "The LLM answer was unusable; kept the classifier's best guess.", [f"category answer invalid: {str(exc)[:120]}"])
    except LlmUnavailable:
        return Decision("llm", top_cat, top_p, "The LLM was unavailable; kept the classifier's best guess.", llm_down=True)
    if choice.category not in candidates:
        return Decision("llm", top_cat, top_p, choice.reason, [f"category {choice.category} is not one of {candidates}"])
    return Decision("llm", choice.category, dict(top3)[choice.category], choice.reason)


class State(TypedDict, total=False):
    req: TriageRequest
    run_key: str
    t0: float
    text: str
    top3: list[tuple[str, float]]
    similar: list[SimilarIncident]
    articles: list[Article]
    decision: Decision
    reply: str
    cited: list[str]
    draft_errors: list[str]
    feedback: list[str]
    errors: list[str]
    passes: int
    llm_down: bool
    trace: list[StepTrace]
    result: TriageResult


def _step(state: State, name: str, started: float, **detail) -> list[StepTrace]:
    return state.get("trace", []) + [StepTrace(step=name, ms=int((time.perf_counter() - started) * 1000), detail=detail)]


def build_graph(deps: Deps):
    s = deps.settings

    def normalize(state: State):
        t = time.perf_counter()
        req = state["req"]
        text = scrub(f"{req.short_description}\n{req.description}".strip())[:4000]
        return {"text": text, "passes": 0, "errors": [], "feedback": [], "llm_down": False, "trace": _step(state, "normalize", t, chars=len(text))}

    def classify(state: State):
        t = time.perf_counter()
        top3 = deps.classifier.top_k(state["text"], 3)
        return {"top3": top3, "trace": _step(state, "classify", t, top=[[c, round(p, 4)] for c, p in top3])}

    def retrieve(state: State):
        t = time.perf_counter()
        vec = deps.embedder.encode([state["text"]])[0]
        similar = [
            SimilarIncident(ref=h.ref, category=h.category, score=round(h.score, 4), text=h.text[:300])
            for h in deps.store.search("ticket", vec, s.similar_top_k, s.retrieval_exclude_splits)
        ]
        articles = deps.kb.search(vec, s.kb_top_k)
        return {
            "similar": similar,
            "articles": articles,
            "trace": _step(state, "retrieve", t, similar=[x.ref for x in similar], articles=[a.id for a in articles]),
        }

    def decide(state: State):
        t = time.perf_counter()
        d = choose_category(deps, state["text"], state["top3"], state["similar"], state.get("feedback"))
        return {
            "decision": d,
            "llm_down": state.get("llm_down", False) or d.llm_down,
            "trace": _step(state, "decide", t, path=d.path, category=d.category, probability=round(d.confidence, 4), errors=d.errors),
        }

    def fallback_reply(state: State) -> tuple[str, list[str]]:
        group = ASSIGNMENT_GROUPS[state["decision"].category]
        arts = state["articles"][:1]
        if arts:
            return f"Thanks for reporting this. Your request has been routed to {group}. In the meantime this article may help: {arts[0].id} - {arts[0].title}.", [arts[0].id]
        return f"Thanks for reporting this. Your request has been routed to {group} and they will follow up.", []

    def draft(state: State):
        t = time.perf_counter()
        d = state["decision"]
        if state.get("llm_down"):
            reply, cited = fallback_reply(state)
            return {"reply": reply, "cited": cited, "draft_errors": [], "trace": _step(state, "draft", t, source="template")}
        art_text = "\n\n".join(f"[{a.id}] {a.title}\n{a.text[:700]}" for a in state["articles"]) or "(no articles found)"
        user = f"Ticket:\n{state['text'][:1200]}\n\nCategory: {d.category}\n\nKnowledge articles:\n{art_text}\n"
        if state.get("feedback"):
            user += "\nYour previous reply was rejected: " + "; ".join(state["feedback"])
        try:
            out = deps.llm.run("draft", DRAFT_SYSTEM, user, LlmReply, max_tokens=320)
        except (ValidationError, ValueError) as exc:
            return {"reply": "", "cited": [], "draft_errors": [f"reply invalid: {str(exc)[:120]}"], "trace": _step(state, "draft", t, source="llm", error="invalid")}
        except LlmUnavailable:
            reply, cited = fallback_reply(state)
            return {"reply": reply, "cited": cited, "llm_down": True, "draft_errors": [], "trace": _step(state, "draft", t, source="template")}
        return {"reply": clean_reply(out.reply), "cited": out.cited_articles, "draft_errors": [], "trace": _step(state, "draft", t, source="llm", cited=out.cited_articles)}

    def validate(state: State):
        t = time.perf_counter()
        d = state["decision"]
        errors = list(d.errors) + list(state.get("draft_errors", []))
        if d.category not in CATEGORIES:
            errors.append(f"category {d.category} is not valid")
        group = ASSIGNMENT_GROUPS.get(d.category)
        if group is None or (deps.known_groups is not None and group not in deps.known_groups):
            errors.append(f"assignment group for {d.category} does not exist")
        retrieved = {a.id for a in state["articles"]}
        for cid in state.get("cited", []):
            if cid not in retrieved:
                errors.append(f"citation {cid} was not in the retrieved articles")
        for cid in KB_REF.findall(state.get("reply", "")):
            if cid not in retrieved:
                errors.append(f"citation {cid} in the reply text was not retrieved")
        if not state.get("reply"):
            errors.append("reply is empty")
        elif contains_pii(state["reply"]):
            errors.append("reply contains personal data")
        errors = list(dict.fromkeys(errors))
        passes = state.get("passes", 0) + 1
        return {"errors": errors, "feedback": errors, "passes": passes, "trace": _step(state, "validate", t, ok=not errors, errors=errors, pass_number=passes)}

    def after_validate(state: State):
        if state["errors"] and state["passes"] < MAX_PASSES:
            return "decide"
        return "finish"

    def finish(state: State):
        t = time.perf_counter()
        req, d = state["req"], state["decision"]
        ok = not state["errors"]
        result = TriageResult(
            run_key=state["run_key"],
            run_sys_id=req.run_sys_id,
            incident_sys_id=req.incident_sys_id,
            status="completed" if ok else "needs_review",
            category=d.category,
            assignment_group=ASSIGNMENT_GROUPS.get(d.category),
            confidence=round(d.confidence, 4),
            classifier_category=state["top3"][0][0],
            path=d.path,
            reasoning=d.reasoning,
            reply_draft=state.get("reply", ""),
            cited_articles=state.get("cited", []) if ok else [],
            similar_incidents=[x.ref for x in state["similar"]],
            retrieved_articles=[a.id for a in state["articles"]],
            attempts=state["passes"],
            errors=state["errors"],
            latency_ms=int((time.perf_counter() - state["t0"]) * 1000),
            trace=state["trace"],
        )
        return {"result": result, "trace": _step(state, "finish", t, status=result.status)}

    def callback(state: State):
        t = time.perf_counter()
        result = state["result"]
        if deps.sn is not None:
            result.latency_ms = int((time.perf_counter() - state["t0"]) * 1000)
            deps.sn.post_result(result.model_dump())
        return {"trace": _step(state, "callback", t, sent=deps.sn is not None)}

    g = StateGraph(State)
    for name, fn in [("normalize", normalize), ("classify", classify), ("retrieve", retrieve), ("decide", decide), ("draft", draft), ("validate", validate), ("finish", finish), ("callback", callback)]:
        g.add_node(name, fn)
    g.set_entry_point("normalize")
    g.add_edge("normalize", "classify")
    g.add_edge("classify", "retrieve")
    g.add_edge("retrieve", "decide")
    g.add_edge("decide", "draft")
    g.add_edge("draft", "validate")
    g.add_conditional_edges("validate", after_validate, {"decide": "decide", "finish": "finish"})
    g.add_edge("finish", "callback")
    g.add_edge("callback", END)
    return g.compile()


def run_triage(graph, req: TriageRequest, run_key: str) -> TriageResult:
    final = graph.invoke({"req": req, "run_key": run_key, "t0": time.perf_counter()})
    return final["result"]
