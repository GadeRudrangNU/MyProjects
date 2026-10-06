from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EvidenceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = ""
    section: Literal["Experience", "Projects", "Education", "Skills", "Other"] = "Experience"
    text: str = Field(default="", max_length=2000)
    skills: list[str] = []
    context: str = ""


class EducationIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    degree: str = ""
    field: str = ""
    school: str = ""
    status: Literal["completed", "in_progress"] = "completed"
    year: str = ""


class WeightsIn(BaseModel):
    skills: float = 35
    experience: float = 20
    role: float = 15
    education: float = 10
    location: float = 10
    preferences: float = 10


class ProfileIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = ""
    headline: str = ""
    target_roles: list[str] = []
    skills: list[str] = []
    experience_months: float = 0
    education: list[EducationIn] = []
    preferred_locations: list[str] = []
    remote_preference: Literal["any", "remote", "hybrid", "onsite"] = "any"
    employment_types: list[str] = []
    industries: list[str] = []
    work_authorization: str = ""
    requires_sponsorship: bool | None = None
    preferred_technologies: list[str] = []
    salary_min: float | None = None
    evidence_items: list[EvidenceIn] = []
    match_weights: WeightsIn = WeightsIn()
    resume_id: int | None = None


class JobCreate(BaseModel):
    company: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=255)
    location: str | None = None
    description: str = Field(min_length=20)
    posting_url: str | None = None
    employment_type: str | None = None
    application_deadline: str | None = None


class UrlIn(BaseModel):
    url: str


class JobPatch(BaseModel):
    user_state: Literal["new", "saved", "ignored"]


class ApplicationCreate(BaseModel):
    job_id: int
    status: str = "Preparing"


class ChecklistItem(BaseModel):
    id: str
    label: str
    done: bool = False


class ApplicationPatch(BaseModel):
    status: str | None = None
    notes: str | None = None
    next_action: str | None = None
    deadline: str | None = None
    resume_version: str | None = None
    checklist: list[ChecklistItem] | None = None
    baseline_minutes: float | None = None
    date_applied: str | None = None


class TimeIn(BaseModel):
    job_id: int | None = None
    application_id: int | None = None
    kind: Literal["job_analysis", "resume_tailoring", "application_preparation"]
    seconds: float = Field(gt=0, le=4 * 3600)


class EventIn(BaseModel):
    name: str
    job_id: int | None = None
    application_id: int | None = None
    properties: dict = {}


class DraftIn(BaseModel):
    kind: Literal["cover_letter", "short_answer", "recruiter_outreach", "networking"]
    question: str | None = None
    force: bool = False


class SuggestionPatch(BaseModel):
    status: Literal["accepted", "rejected", "pending"]
