from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import session_dep
from ..models import Application, Job
from ..schemas import ApplicationCreate, ApplicationPatch
from ..services import store
from ..services.events import STATUSES

router = APIRouter()


def _dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:19])
    except ValueError:
        raise HTTPException(422, f"Invalid date: {s}")


@router.post("/applications")
def create(body: ApplicationCreate, session: Session = Depends(session_dep)):
    job = session.get(Job, body.job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if body.status not in STATUSES:
        raise HTTPException(422, f"Invalid status. Use one of: {', '.join(STATUSES)}")
    app = store.create_application(session, job, body.status, store.get_profile(session))
    return store.application_dict(session, app, job)


@router.patch("/applications/{app_id}")
def patch(app_id: int, body: ApplicationPatch, session: Session = Depends(session_dep)):
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(404, "Application not found")
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        if data["status"] not in STATUSES:
            raise HTTPException(422, f"Invalid status. Use one of: {', '.join(STATUSES)}")
        store.set_status(session, app, data["status"])
    for f in ("notes", "next_action", "resume_version", "baseline_minutes"):
        if f in data:
            setattr(app, f, data[f] if data[f] is not None or f in {"resume_version", "baseline_minutes"} else "")
    if "deadline" in data:
        app.deadline = _dt(data["deadline"])
    if "date_applied" in data:
        app.date_applied = _dt(data["date_applied"])
    if "checklist" in data and data["checklist"] is not None:
        app.checklist = [{"id": c["id"] or uuid.uuid4().hex[:8], "label": c["label"], "done": c["done"]} for c in data["checklist"]]
    session.commit()
    return store.application_dict(session, app)


@router.get("/applications")
def list_apps(status: str | None = None, session: Session = Depends(session_dep)):
    q = select(Application).order_by(Application.updated_at.desc())
    if status:
        q = q.where(Application.status == status)
    return [store.application_dict(session, a) for a in session.scalars(q)]
