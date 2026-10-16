from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CATEGORIES = [
    "Access",
    "Administrative rights",
    "HR Support",
    "Hardware",
    "Internal Project",
    "Miscellaneous",
    "Purchase",
    "Storage",
]
Category = Literal[
    "Access",
    "Administrative rights",
    "HR Support",
    "Hardware",
    "Internal Project",
    "Miscellaneous",
    "Purchase",
    "Storage",
]

ASSIGNMENT_GROUPS: dict[str, str] = {
    "Access": "TP Access Management",
    "Administrative rights": "TP Admin Rights",
    "HR Support": "TP HR Support",
    "Hardware": "TP Hardware Support",
    "Internal Project": "TP Project Desk",
    "Miscellaneous": "TP Service Desk Triage",
    "Purchase": "TP Procurement",
    "Storage": "TP Storage Team",
}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TriageRequest(Strict):
    incident_sys_id: str
    number: str
    short_description: str
    description: str = ""
    priority: int = 4
    mod_count: int = 0
    run_sys_id: str


class TriageAccepted(Strict):
    run_key: str
    status: str
    duplicate: bool = False


class StepTrace(Strict):
    step: str
    ms: int
    detail: dict = Field(default_factory=dict)


class Article(Strict):
    id: str
    title: str
    text: str
    score: float = 0.0


class SimilarIncident(Strict):
    ref: str
    category: str
    score: float
    text: str


class LlmCategoryChoice(Strict):
    category: Category
    reason: str = Field(max_length=400)


class LlmReply(Strict):
    reply: str = Field(min_length=10, max_length=1200)
    cited_articles: list[str] = Field(default_factory=list)


class LlmArticle(Strict):
    title: str = Field(min_length=5, max_length=160)
    symptoms: str = Field(min_length=5)
    resolution_steps: list[str] = Field(min_length=1)


class TriageResult(Strict):
    run_key: str
    run_sys_id: str
    incident_sys_id: str
    status: Literal["completed", "needs_review", "failed"]
    category: Category | None = None
    assignment_group: str | None = None
    confidence: float = 0.0
    classifier_category: str | None = None
    path: Literal["fast", "llm"] | None = None
    reasoning: str = ""
    reply_draft: str = ""
    cited_articles: list[str] = Field(default_factory=list)
    similar_incidents: list[str] = Field(default_factory=list)
    retrieved_articles: list[str] = Field(default_factory=list)
    latency_ms: int = 0
    attempts: int = 1
    errors: list[str] = Field(default_factory=list)
    trace: list[StepTrace] = Field(default_factory=list)
