from __future__ import annotations

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import session_dep
from ..models import AIGeneration, Application, Job
from ..schemas import DraftIn, JobCreate, JobPatch, SuggestionPatch, UrlIn
from ..services import ai_service, job_parser, matching, store
from ..services.events import STATUSES, track
from ..services.url_fetch import ExtractionError, fetch_posting

router = APIRouter()


def _job_or_404(session: Session, job_id: int) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


def _need_profile(session: Session) -> dict:
    profile = store.get_profile(session)
    if not profile["exists"]:
        raise HTTPException(409, {"code": "profile_required", "message": "Create your profile first."})
    return profile


def _parse_date(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:19])
    except ValueError:
        return None


def _out(session: Session, job: Job, profile: dict, include_raw: bool = False) -> dict:
    app = session.scalar(select(Application).where(Application.job_id == job.id))
    match = store.get_match(session, job, profile)
    return store.job_dict(job, include_raw, app, match)


@router.post("/jobs")
def create_job(body: JobCreate, session: Session = Depends(session_dep)):
    job, _ = store.create_job(session, company=body.company, title=body.title, description=body.description,
                              location=body.location, posting_url=body.posting_url,
                              employment_type=body.employment_type,
                              deadline=_parse_date(body.application_deadline), source="manual")
    return _out(session, job, store.get_profile(session), include_raw=True)


@router.post("/jobs/from-url")
def create_from_url(body: UrlIn, session: Session = Depends(session_dep)):
    try:
        d = fetch_posting(body.url.strip())
    except ExtractionError as exc:
        raise HTTPException(422, {"code": "extraction_failed", "message": str(exc)})
    if not d["title"] or not d["company"]:
        raise HTTPException(422, {"code": "extraction_failed",
                                  "message": "Found page text but not a clear title/company. Please paste the job details instead."})
    job, _ = store.create_job(session, company=d["company"][:255], title=d["title"][:255], description=d["description"],
                              location=d["location"], posting_url=body.url.strip(), employment_type=None,
                              deadline=_parse_date(d["deadline"]), source="url")
    return _out(session, job, store.get_profile(session), include_raw=True)


@router.post("/jobs/import-csv")
async def import_csv(file: UploadFile = File(...), session: Session = Depends(session_dep)):
    text = (await file.read()).decode("utf-8-sig", errors="ignore")
    imported = dupes = 0
    errors: list[str] = []
    for i, row in enumerate(csv.DictReader(io.StringIO(text)), start=2):
        if i > 2001:
            errors.append("Stopped at 2000 rows.")
            break
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        company, title, desc = r.get("company", ""), r.get("title", ""), r.get("description", "")
        if not (company and title and len(desc) >= 20):
            errors.append(f"Row {i}: needs company, title and a description of at least 20 characters.")
            continue
        _, created = store.create_job(
            session, company=company, title=title, description=desc, location=r.get("location") or None,
            posting_url=r.get("url") or r.get("posting_url") or None, employment_type=r.get("employment_type") or None,
            deadline=_parse_date(r.get("deadline") or r.get("application_deadline")), source="csv")
        imported += created
        dupes += not created
    return {"imported": imported, "skipped_duplicates": dupes, "errors": errors[:20]}


@router.get("/jobs")
def list_jobs(q: str | None = None, role: str | None = None, location: str | None = None, company: str | None = None,
              status: str | None = None, application_status: str | None = None, min_score: float | None = None,
              remote: bool | None = None, sort: str = Query("best_match", pattern="^(best_match|newest|deadline|status)$"),
              session: Session = Depends(session_dep)):
    profile = store.get_profile(session)
    apps = {a.job_id: a for a in session.scalars(select(Application))}
    rows = []
    for job in session.scalars(select(Job)):
        blob = f"{job.title} {job.company} {job.raw_description}".lower()
        if q and q.lower() not in blob:
            continue
        if role and role.lower() not in job.title.lower():
            continue
        if location and location.lower() not in (job.location or "").lower() and not (job.is_remote and "remote" in location.lower()):
            continue
        if company and company.lower() not in job.company.lower():
            continue
        if status and job.user_state != status:
            continue
        if remote is not None and job.is_remote != remote:
            continue
        app = apps.get(job.id)
        if application_status and (app.status if app else None) != application_status:
            continue
        match = store.get_match(session, job, profile)
        if min_score is not None and (match is None or match["overall"] < min_score):
            continue
        rows.append(store.job_dict(job, False, app, match))
    far = datetime.max.isoformat()
    order = {s: i for i, s in enumerate(STATUSES)}
    if sort == "best_match":
        rows.sort(key=lambda r: (r["match_score"] is None, -(r["match_score"] or 0), r["id"]))
    elif sort == "newest":
        rows.sort(key=lambda r: r["date_added"], reverse=True)
    elif sort == "deadline":
        rows.sort(key=lambda r: (r["application_deadline"] is None, r["application_deadline"] or far))
    else:
        rows.sort(key=lambda r: (order.get(r["application_status"], -1) if r["application_status"] else -1, r["user_state"]))
    return rows


@router.get("/jobs/{job_id}")
def get_job(job_id: int, session: Session = Depends(session_dep)):
    return _out(session, _job_or_404(session, job_id), store.get_profile(session), include_raw=True)


@router.patch("/jobs/{job_id}")
def patch_job(job_id: int, body: JobPatch, session: Session = Depends(session_dep)):
    job = _job_or_404(session, job_id)
    prev = job.user_state
    job.user_state = body.user_state
    session.commit()
    profile = store.get_profile(session)
    if body.user_state == "saved" and prev != "saved":
        track(session, "job_saved", job_id=job.id)
        if not session.scalar(select(Application).where(Application.job_id == job.id)):
            store.create_application(session, job, "Saved", profile)
    elif body.user_state == "ignored" and prev != "ignored":
        track(session, "job_ignored", job_id=job.id)
    return _out(session, job, profile, include_raw=True)


@router.post("/jobs/{job_id}/analyze")
def analyze(job_id: int, session: Session = Depends(session_dep)):
    job = _job_or_404(session, job_id)
    profile = _need_profile(session)
    result = store.get_match(session, job, profile)
    track(session, "job_analyzed", job_id=job.id, properties={"overall": result["overall"]})
    return result


@router.get("/jobs/{job_id}/match")
def get_match(job_id: int, weights: str | None = None, session: Session = Depends(session_dep)):
    job = _job_or_404(session, job_id)
    profile = _need_profile(session)
    override = matching.parse_weights_param(weights)
    return store.get_match(session, job, profile, weights_override=override, persist=False)


@router.get("/jobs/{job_id}/gap-analysis")
def gap(job_id: int, session: Session = Depends(session_dep)):
    job = _job_or_404(session, job_id)
    profile = _need_profile(session)
    track(session, "gap_analysis_viewed", job_id=job.id)
    return matching.gap_analysis(store.job_for_matching(job), profile)


def _latest_gen(session: Session, job_id: int, kind: str) -> AIGeneration | None:
    return session.scalars(select(AIGeneration).where(AIGeneration.job_id == job_id, AIGeneration.kind == kind)
                           .order_by(AIGeneration.id.desc())).first()


def _tailor_out(g: AIGeneration) -> dict:
    p = g.payload
    return {"generation_id": g.id, "provider": p["provider"], "cached": p.get("cached", False), "notice": p["notice"],
            "suggestions": [dict(s, index=i) for i, s in enumerate(p["suggestions"])]}


@router.post("/jobs/{job_id}/tailor")
def tailor(job_id: int, force: bool = False, session: Session = Depends(session_dep)):
    job = _job_or_404(session, job_id)
    profile = _need_profile(session)
    w = matching.normalize_weights(profile.get("match_weights"))
    ph = matching.profile_hash(profile, w)
    prev = _latest_gen(session, job_id, "tailor")
    if prev and not force and prev.payload.get("profile_hash") == ph:
        out = _tailor_out(prev)
        out["cached"] = True
        return out
    result = ai_service.tailor(session, store.job_for_matching(job), profile, force=force)
    g = AIGeneration(job_id=job_id, kind="tailor", provider=result["provider"], prompt_hash=ph,
                     payload={**result, "profile_hash": ph})
    session.add(g)
    session.commit()
    track(session, "resume_suggestion_generated", job_id=job_id,
          properties={"count": len(result["suggestions"]), "provider": result["provider"]})
    return _tailor_out(g)


@router.get("/jobs/{job_id}/tailor")
def get_tailor(job_id: int, session: Session = Depends(session_dep)):
    _job_or_404(session, job_id)
    g = _latest_gen(session, job_id, "tailor")
    return _tailor_out(g) if g else None


@router.patch("/generations/{generation_id}/suggestions/{index}")
def patch_suggestion(generation_id: int, index: int, body: SuggestionPatch, session: Session = Depends(session_dep)):
    g = session.get(AIGeneration, generation_id)
    if not g or g.kind != "tailor" or not (0 <= index < len(g.payload["suggestions"])):
        raise HTTPException(404, "Suggestion not found")
    payload = dict(g.payload)
    sugg = [dict(s) for s in payload["suggestions"]]
    prev = sugg[index]["status"]
    sugg[index]["status"] = body.status
    payload["suggestions"] = sugg
    g.payload = payload
    session.commit()
    if body.status == "accepted" and prev != "accepted":
        track(session, "resume_suggestion_accepted", job_id=g.job_id, properties={"generation_id": g.id, "index": index})
    return dict(sugg[index], index=index)


def _draft_out(g: AIGeneration) -> dict:
    p = g.payload
    return {"generation_id": g.id, "kind": p["kind"], "provider": p["provider"], "cached": p.get("cached", False),
            "is_template": p["is_template"], "text": p["text"], "facts_used": p["facts_used"],
            "unsupported_skills": p.get("unsupported_skills", []), "notice": p.get("notice"),
            "disclaimer": p["disclaimer"], "question": p.get("question")}


@router.post("/jobs/{job_id}/draft")
def make_draft(job_id: int, body: DraftIn, session: Session = Depends(session_dep)):
    job = _job_or_404(session, job_id)
    profile = _need_profile(session)
    match = store.get_match(session, job, profile)
    w = matching.normalize_weights(profile.get("match_weights"))
    ph = matching.profile_hash(profile, w) + (body.question or "")
    if not body.force:
        for g in session.scalars(select(AIGeneration).where(
                AIGeneration.job_id == job_id, AIGeneration.kind == "draft").order_by(AIGeneration.id.desc())):
            if g.payload.get("kind") == body.kind and g.prompt_hash == ph[:64] and g.payload.get("q") == (body.question or ""):
                out = _draft_out(g)
                out["cached"] = True
                return out
    result = ai_service.draft(session, store.job_for_matching(job), profile, match, body.kind, body.question, force=body.force)
    g = AIGeneration(job_id=job_id, kind="draft", provider=result["provider"], prompt_hash=ph[:64],
                     payload={**result, "kind": body.kind, "q": body.question or "", "question": body.question})
    session.add(g)
    session.commit()
    track(session, "draft_generated", job_id=job_id, properties={"kind": body.kind, "provider": result["provider"]})
    return _draft_out(g)


@router.get("/jobs/{job_id}/drafts")
def list_drafts(job_id: int, session: Session = Depends(session_dep)):
    _job_or_404(session, job_id)
    gens = session.scalars(select(AIGeneration).where(AIGeneration.job_id == job_id, AIGeneration.kind == "draft")
                           .order_by(AIGeneration.id.desc())).all()
    return [_draft_out(g) for g in gens]
