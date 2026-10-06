"""Persistence helpers"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (AIGeneration, AnalyticsEvent, Application, ApplicationEvent, Job, JobMatch, Profile, Resume,
                      TimeRecord, utcnow)
from . import job_parser, matching
from .events import STATUSES, track
from .skills import canonicalize

DEFAULT_CHECKLIST = ["Review the job description and requirements", "Tailor resume bullets (approve each change)",
                     "Draft cover letter / short answers (review before using)", "Proofread everything",
                     "Submit on the employer's site yourself", "Set a follow-up reminder"]

PROFILE_DEFAULTS = {
    "name": "", "headline": "", "target_roles": [], "skills": [], "experience_months": 0, "education": [],
    "preferred_locations": [], "remote_preference": "any", "employment_types": [], "industries": [],
    "work_authorization": "", "requires_sponsorship": None, "preferred_technologies": [], "salary_min": None,
    "evidence_items": [], "match_weights": dict(matching.DEFAULT_WEIGHTS), "resume_id": None,
}


def get_profile(session: Session) -> dict:
    row = session.scalar(select(Profile))
    data = dict(PROFILE_DEFAULTS)
    exists = bool(row and row.data)
    if exists:
        data.update(row.data)
    data["exists"] = exists
    return data


def save_profile(session: Session, payload: dict) -> dict:
    data = dict(payload)
    data["skills"] = _dedupe([canonicalize(s) for s in data.get("skills", []) if s.strip()])
    data["preferred_technologies"] = _dedupe([canonicalize(s) for s in data.get("preferred_technologies", []) if s.strip()])
    ev = []
    for e in data.get("evidence_items", []):
        if not e.get("text", "").strip():
            continue
        e = dict(e)
        e["id"] = e.get("id") or uuid.uuid4().hex[:10]
        e["skills"] = _dedupe([canonicalize(s) for s in e.get("skills", []) if s.strip()])
        ev.append(e)
    data["evidence_items"] = ev
    data["match_weights"] = matching.normalize_weights(data.get("match_weights"))
    row = session.scalar(select(Profile))
    first = row is None or not row.data
    if row is None:
        row = Profile(data=data, resume_id=data.get("resume_id"))
        session.add(row)
    else:
        row.data = data
        row.resume_id = data.get("resume_id")
        row.updated_at = utcnow()
    session.commit()
    if first:
        track(session, "profile_created")
    return get_profile(session)


def _dedupe(xs: list[str]) -> list[str]:
    seen, out = set(), []
    for x in xs:
        if x and x.lower() not in seen:
            seen.add(x.lower())
            out.append(x)
    return out


def create_job(session: Session, *, company: str, title: str, description: str, location: str | None = None,
               posting_url: str | None = None, employment_type: str | None = None,
               deadline: datetime | None = None, source: str = "manual") -> tuple[Job, bool]:
    parsed = job_parser.parse_job(description, title=title, company=company, location=location,
                                  employment_type=employment_type, deadline=deadline)
    fp = job_parser.fingerprint(company, title, parsed["location"], description)
    existing = session.scalar(select(Job).where(Job.fingerprint == fp))
    if existing:
        return existing, False
    job = Job(fingerprint=fp, raw_description=description.strip(), posting_url=posting_url, source=source,
              **{k: v for k, v in parsed.items()})
    session.add(job)
    session.commit()
    track(session, "job_added", job_id=job.id, properties={"source": source})
    return job, True


def job_dict(job: Job, include_raw: bool = False, app: Application | None = None, match: dict | None = None) -> dict:
    d = {
        "id": job.id, "company": job.company, "title": job.title, "location": job.location,
        "employment_type": job.employment_type, "salary_text": job.salary_text,
        "required_skills": job.required_skills, "preferred_skills": job.preferred_skills,
        "minimum_experience_years": job.minimum_experience_years, "education": job.education,
        "responsibilities": job.responsibilities, "keywords": job.keywords,
        "work_authorization_notes": job.work_authorization_notes, "posting_url": job.posting_url,
        "date_added": job.date_added.isoformat(),
        "application_deadline": job.application_deadline.isoformat() if job.application_deadline else None,
        "source": job.source, "parse_notes": job.parse_notes, "is_remote": job.is_remote, "user_state": job.user_state,
        "application_id": app.id if app else None, "application_status": app.status if app else None,
        "match_score": match["overall"] if match else None,
        "match_summary": matching.summarize(match) if match else None,
    }
    if include_raw:
        d["raw_description"] = job.raw_description
    return d


def job_for_matching(job: Job) -> dict:
    return {
        "id": job.id, "company": job.company, "title": job.title, "location": job.location,
        "employment_type": job.employment_type, "salary_min": job.salary_min, "salary_max": job.salary_max,
        "required_skills": job.required_skills, "preferred_skills": job.preferred_skills,
        "minimum_experience_years": job.minimum_experience_years, "education": job.education,
        "responsibilities": job.responsibilities, "work_authorization_notes": job.work_authorization_notes,
        "application_deadline": job.application_deadline, "is_remote": job.is_remote,
        "raw_description": job.raw_description,
    }


def get_match(session: Session, job: Job, profile: dict, weights_override: dict | None = None,
              persist: bool = True) -> dict | None:
    if not profile.get("exists"):
        return None
    w = matching.normalize_weights(weights_override or profile.get("match_weights"))
    ph = matching.profile_hash(profile, w)
    if weights_override is None:
        row = session.scalar(select(JobMatch).where(JobMatch.job_id == job.id, JobMatch.profile_hash == ph))
        if row:
            return row.result
    result = matching.compute_match(job_for_matching(job), profile, w)
    if persist and weights_override is None:
        session.add(JobMatch(job_id=job.id, profile_hash=ph, overall=result["overall"], result=result))
        session.commit()
    return result


def assisted_minutes(session: Session, job_id: int) -> float:
    s = session.scalar(select(func.coalesce(func.sum(TimeRecord.seconds), 0.0)).where(TimeRecord.job_id == job_id))
    return round((s or 0.0) / 60.0, 1)


def application_dict(session: Session, app: Application, job: Job | None = None) -> dict:
    job = job or session.get(Job, app.job_id)
    hist = session.scalars(select(ApplicationEvent).where(ApplicationEvent.application_id == app.id)
                           .order_by(ApplicationEvent.id)).all()
    return {
        "id": app.id, "job_id": app.job_id, "company": job.company, "title": job.title, "status": app.status,
        "resume_version": app.resume_version, "match_score": app.match_score,
        "date_discovered": app.date_discovered.isoformat(),
        "date_applied": app.date_applied.isoformat() if app.date_applied else None,
        "notes": app.notes, "next_action": app.next_action,
        "deadline": (app.deadline or job.application_deadline).isoformat() if (app.deadline or job.application_deadline) else None,
        "checklist": app.checklist, "baseline_minutes": app.baseline_minutes,
        "assisted_minutes": assisted_minutes(session, app.job_id),
        "history": [{"from_status": h.from_status, "to_status": h.to_status, "at": h.created_at.isoformat()} for h in hist],
        "created_at": app.created_at.isoformat(), "updated_at": app.updated_at.isoformat(),
    }


def set_status(session: Session, app: Application, new: str) -> None:
    if new not in STATUSES:
        raise ValueError(f"Invalid status: {new}")
    old = app.status
    if new == old and session.scalar(select(ApplicationEvent.id).where(ApplicationEvent.application_id == app.id)):
        return
    app.status = new
    session.add(ApplicationEvent(application_id=app.id, from_status=old if new != old else None, to_status=new))
    if new == "Applied" and app.date_applied is None:
        app.date_applied = utcnow()
    session.commit()
    jid, aid = app.job_id, app.id
    if new == "Preparing" and not session.scalar(select(AnalyticsEvent.id).where(
            AnalyticsEvent.name == "application_started", AnalyticsEvent.application_id == aid)):
        track(session, "application_started", job_id=jid, application_id=aid)
    if old != new:
        track(session, "status_changed", job_id=jid, application_id=aid, properties={"from": old, "to": new})
        special = {"Applied": "application_marked_applied", "Interview": "interview_received", "Offer": "offer_received"}
        if new in special:
            track(session, special[new], job_id=jid, application_id=aid)


def create_application(session: Session, job: Job, status: str, profile: dict) -> Application:
    if status not in STATUSES:
        raise ValueError(f"Invalid status: {status}")
    app = session.scalar(select(Application).where(Application.job_id == job.id))
    if app:
        if app.status != status:
            set_status(session, app, status)
        return app
    match = get_match(session, job, profile)
    app = Application(job_id=job.id, status="Discovered", match_score=match["overall"] if match else None,
                      date_discovered=job.date_added,
                      checklist=[{"id": uuid.uuid4().hex[:8], "label": l, "done": False} for l in DEFAULT_CHECKLIST])
    session.add(app)
    session.commit()
    session.add(ApplicationEvent(application_id=app.id, from_status=None, to_status="Discovered"))
    session.commit()
    if status != "Discovered":
        set_status(session, app, status)
    return app


def delete_all_user_data(session: Session) -> dict:
    counts = {}
    for key, model in [("applications_events", ApplicationEvent), ("applications", Application), ("job_matches", JobMatch),
                       ("events", AnalyticsEvent), ("generations", AIGeneration), ("time_records", TimeRecord),
                       ("resumes", Resume), ("profile", Profile), ("jobs", Job)]:
        counts[key] = session.query(model).delete()
    session.commit()
    counts.pop("applications_events")
    return counts
