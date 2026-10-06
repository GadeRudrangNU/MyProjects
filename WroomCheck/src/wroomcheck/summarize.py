"""Source-cited defect summaries.

Two modes:
  * "ollama": a LangChain chain (prompt | ChatOllama | parser) running a free local LLM. Output is
    validated by `grounding.check_summary`; one retry, then fall back to extractive mode.
  * "extractive": deterministic template + verbatim quotes. Always grounded; needs no LLM.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Callable, Mapping

from .grounding import GroundingReport, check_summary
from .models import Alert, Complaint

SYSTEM = (
    "You are a vehicle-safety analyst. Summarise a cluster of owner complaints using ONLY the "
    "numbered complaints provided. Write 3 or 4 short sentences. End EVERY sentence with the "
    "citation(s) of the complaints that support it, formatted exactly like [C12345]. Only state "
    "numbers (counts, years, dates) that appear in the complaints or in the Facts. Do not guess "
    "causes, do not mention recalls, and do not add information that is not in the complaints."
)
HUMAN = "Facts:\n{facts}\n\nComplaints:\n{evidence}\n\nSummary:"

_WORD = re.compile(r"[a-z]{4,}")
_STOP = frozenset("""this that with from have were when they then there their would could after before while
about been being into which what where also very just again over only than them some other more most
vehicle dealer dealership stated told said""".split())


@dataclass
class Summary:
    text: str
    mode: str  # ollama | extractive
    grounding: GroundingReport
    llm_attempted: bool = False
    llm_grounded: bool | None = None  # grounding verdict on the raw LLM output (None if no LLM)


def keywords(texts: list[str], k: int = 4) -> list[str]:
    counts: Counter[str] = Counter()
    for t in texts:
        words = [w for w in _WORD.findall(t.lower()) if w not in _STOP]
        counts.update(set(words))
    return [w for w, _ in counts.most_common(k)]


def facts_for(alert: Alert) -> str:
    years = ", ".join(map(str, alert.years)) or "unknown"
    return (
        f"vehicle: {alert.make} {alert.model}; model years: {years}; component: {alert.comp_cat}; "
        f"first complaint in cluster: {alert.first_date.isoformat()}; alert raised: {alert.alert_date.isoformat()}; "
        f"complaints in the 90 days before the alert: {alert.n_window}; of which crash/fire/injury reports: {alert.severe_window}"
    )


def format_evidence(complaints: list[Complaint], max_chars: int = 450) -> str:
    return "\n".join(
        f"[C{c.id}] ({c.year} {c.make} {c.model}, received {c.date_received.isoformat()}"
        f"{', SEVERE' if c.severe else ''}) {c.text[:max_chars]}"
        for c in complaints
    )


def _sentences(text: str, n: int = 2) -> list[str]:
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", text) if len(p.strip()) > 25]
    return parts[:n]


def extractive_summary(alert: Alert, complaints: list[Complaint]) -> str:
    first = complaints[0]
    ids = lambda cs: "".join(f"[C{c.id}]" for c in cs)  # noqa: E731
    years = " and ".join(map(str, alert.years)) or "multiple"
    lines = [
        f"{alert.n_window} owners of {years} {alert.make} {alert.model} vehicles reported {alert.comp_cat.lower()} "
        f"problems in the 90 days before {alert.alert_date.isoformat()} {ids(complaints[:2])}.",
    ]
    if alert.severe_window:
        severe = [c for c in complaints if c.severe][:2]
        lines.append(
            f"{alert.severe_window} of these reports involved a crash, fire or injury {ids(severe)}."
            if severe else ""
        )
    seen: set[str] = set()
    for c in complaints:
        quote = _sentences(c.text, 1)
        key = quote[0][:60].lower() if quote else ""
        if quote and key not in seen:  # owners often copy-paste the same text; quote it once
            seen.add(key)
            lines.append(f'One owner wrote: "{quote[0].rstrip(".")}" [C{c.id}].')
        if len(seen) == 3:
            break
    return " ".join(line for line in lines if line)


def build_llm_chain(model: str, base_url: str) -> Callable[[dict], str]:
    """LangChain LCEL chain: prompt | ChatOllama | StrOutputParser."""
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_ollama import ChatOllama

    prompt = ChatPromptTemplate.from_messages([("system", SYSTEM), ("human", HUMAN)])
    chain = prompt | ChatOllama(model=model, base_url=base_url, temperature=0) | StrOutputParser()
    return chain.invoke


class Summarizer:
    def __init__(self, llm: Callable[[dict], str] | None = None, retries: int = 1):
        self.llm, self.retries = llm, retries

    def summarize(self, alert: Alert, complaints: list[Complaint]) -> Summary:
        evidence = {c.id: c.text for c in complaints}
        facts = facts_for(alert)
        llm_ok: bool | None = None
        if self.llm:
            for _ in range(1 + self.retries):
                try:
                    text = self.llm({"facts": facts, "evidence": format_evidence(complaints)}).strip()
                except Exception as exc:  # LLM server down etc: degrade gracefully
                    print(f"  LLM call failed ({exc}); using extractive summary")
                    llm_ok = False
                    break
                report = check_summary(text, evidence, facts)
                llm_ok = report.ok
                if report.ok:
                    return Summary(text, "ollama", report, True, True)
        text = extractive_summary(alert, complaints)
        return Summary(text, "extractive", check_summary(text, evidence, facts), self.llm is not None, llm_ok)


def summaries_for(
    alerts: list[Alert], texts: Mapping[int, Complaint], summarizer: Summarizer
) -> dict[int, Summary]:
    """Return {alert index: Summary}."""
    return {
        i: summarizer.summarize(a, [texts[x] for x in a.evidence_ids if x in texts])
        for i, a in enumerate(alerts)
    }
