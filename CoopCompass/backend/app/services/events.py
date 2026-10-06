"""Local event tracking"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import AnalyticsEvent

ALLOWED_EVENTS = {
    "session_start", "session_end", "profile_created", "resume_uploaded", "job_added", "job_analyzed", "job_saved",
    "job_ignored", "application_started", "resume_suggestion_generated", "resume_suggestion_accepted",
    "draft_generated", "application_marked_applied", "status_changed", "interview_received", "offer_received",
    "gap_analysis_viewed", "incorrect_recommendation_reported",
}

STATUSES = ["Discovered", "Saved", "Preparing", "Applied", "Assessment", "Interview", "Offer", "Rejected", "Withdrawn"]


def track(session: Session, name: str, job_id: int | None = None, application_id: int | None = None,
          properties: dict | None = None, commit: bool = True) -> AnalyticsEvent:
    if name not in ALLOWED_EVENTS:
        raise ValueError(f"Unknown event name: {name}")
    ev = AnalyticsEvent(name=name, job_id=job_id, application_id=application_id, properties=properties or {})
    session.add(ev)
    if commit:
        session.commit()
    return ev
