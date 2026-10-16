from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .kb import KnowledgeBase, plain
from .llm import LlmUnavailable, StructuredLlm
from .pii import contains_pii, scrub
from .schemas import LlmArticle


class ResolvedIncident(BaseModel):
    model_config = ConfigDict(extra="forbid")

    incident_sys_id: str
    number: str
    short_description: str
    description: str = ""
    category: str = ""
    close_notes: str = Field(min_length=1)


class ArticleOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    reason: str = ""
    article_number: str | None = None
    nearest: str | None = None
    similarity: float = 0.0


SYSTEM = (
    "You turn a resolved IT ticket into a short knowledge article for the next person who hits the same problem. "
    "Use only what is in the ticket and its resolution notes. Do not add steps that are not in the notes. "
    "Write symptoms in one or two sentences and the resolution as short numbered-style steps. "
    "No names, emails, phone numbers or IP addresses. Answer with JSON only."
)


class KnowledgeAgent:
    def __init__(self, llm: StructuredLlm, kb: KnowledgeBase, embedder, sn, duplicate_threshold: float):
        self.llm, self.kb, self.embedder, self.sn, self.threshold = llm, kb, embedder, sn, duplicate_threshold

    def run(self, inc: ResolvedIncident) -> ArticleOutcome:
        text = scrub(f"{inc.short_description}. {inc.description} {inc.close_notes}")
        vec = self.embedder.encode([text])[0]
        nearest, score = self.kb.nearest_score(vec)
        if nearest and score >= self.threshold:
            return ArticleOutcome(status="skipped_duplicate", reason="a very similar article already exists", nearest=nearest, similarity=round(score, 4))
        user = (
            f"Ticket: {scrub(inc.short_description)}\nDetails: {scrub(inc.description)[:1200]}\n"
            f"Category: {inc.category}\nResolution notes: {scrub(inc.close_notes)[:1200]}"
        )
        try:
            art = self.llm.run("article", SYSTEM, user, LlmArticle)
        except (LlmUnavailable, ValidationError, ValueError) as exc:
            return ArticleOutcome(status="failed", reason=str(exc)[:200])
        body = f"<p><b>Symptoms</b></p><p>{art.symptoms}</p><p><b>Resolution</b></p><ol>" + "".join(f"<li>{s}</li>" for s in art.resolution_steps) + "</ol>"
        if contains_pii(plain(body)) or contains_pii(art.title):
            return ArticleOutcome(status="failed", reason="draft contained personal data")
        # the incident text and an article read differently, so compare the finished draft with the existing articles too
        draft_vec = self.embedder.encode([f"{art.title}. {plain(body)}"])[0]
        nearest, score = self.kb.nearest_score(draft_vec)
        if nearest and score >= self.threshold:
            return ArticleOutcome(status="skipped_duplicate", reason="the drafted article matches an existing one", nearest=nearest, similarity=round(score, 4))
        created = self.sn.create_article_draft(
            {"short_description": art.title, "text": body, "u_source_incident": inc.incident_sys_id, "u_category": inc.category}
        )
        if created.get("number"):
            self.kb.add_draft(created["number"], art.title, plain(body))
        return ArticleOutcome(status="drafted", article_number=created.get("number"), nearest=nearest, similarity=round(score, 4))
