from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..db import session_dep
from ..models import Resume
from ..schemas import EventIn, ProfileIn, TimeIn
from ..services import resume_parser, store
from ..services.events import ALLOWED_EVENTS, track
from ..models import AnalyticsEvent, TimeRecord

router = APIRouter()
MAX_UPLOAD = 5 * 1024 * 1024


@router.get("/profile")
def get_profile(session: Session = Depends(session_dep)):
    return store.get_profile(session)


@router.post("/profile")
def post_profile(body: ProfileIn, session: Session = Depends(session_dep)):
    return store.save_profile(session, body.model_dump())


@router.post("/resume/upload")
async def upload_resume(file: UploadFile = File(...), session: Session = Depends(session_dep)):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 5 MB).")
    try:
        text, warnings = resume_parser.extract_text(file.filename or "resume.txt", data)
    except ValueError as exc:
        raise HTTPException(415, str(exc))
    except Exception:
        raise HTTPException(422, "Could not read that file. Try a different PDF/DOCX or upload a .txt export.")
    draft = resume_parser.parse_resume(text)
    warnings = warnings + draft.pop("warnings")
    row = Resume(filename=(file.filename or "resume")[:255], text=text, parsed=draft)
    session.add(row)
    session.commit()
    track(session, "resume_uploaded")
    return {"resume_id": row.id, "filename": row.filename, "char_count": len(text), "warnings": warnings, "draft": draft}


@router.post("/events")
def post_event(body: EventIn, session: Session = Depends(session_dep)):
    if body.name not in ALLOWED_EVENTS:
        raise HTTPException(422, f"Unknown event: {body.name}")
    ev = track(session, body.name, body.job_id, body.application_id, body.properties)
    return {"id": ev.id}


@router.post("/time-records")
def post_time(body: TimeIn, session: Session = Depends(session_dep)):
    rec = TimeRecord(job_id=body.job_id, application_id=body.application_id, kind=body.kind, seconds=body.seconds)
    session.add(rec)
    session.commit()
    return {"id": rec.id}


@router.delete("/data")
def delete_data(confirm: bool = False, session: Session = Depends(session_dep)):
    if not confirm:
        raise HTTPException(400, "Pass ?confirm=true to delete all locally stored data.")
    return {"deleted": store.delete_all_user_data(session)}
