"""Roadmap Service: promote themes into Now/Next/Later/Investigate/Won't Do with PM rationale."""
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.app.models import RoadmapItem, Theme
from backend.app.services import priorities, stats
from backend.app.services.themes import ServiceError

BUCKETS = ["now", "next", "later", "investigate", "wont_do"]
STATUSES = ["proposed", "planned", "in_progress", "shipped", "blocked"]


def _serialize(item: RoadmapItem, theme: Theme, rank_by_theme: dict[int, dict], table: dict) -> dict:
    r = rank_by_theme.get(item.theme_id)
    t = table["themes"].get(item.theme_id, {})
    return {
        "id": item.id, "theme_id": item.theme_id, "theme_label": theme.label, "bucket": item.bucket,
        "status": item.status, "rationale": item.rationale, "notes": item.notes,
        "evidence_links": item.evidence_links or [], "priority_snapshot": item.priority_snapshot,
        "current_priority": None if r is None else r["priority"], "current_rank": None if r is None else r["rank"],
        "mentions": t.get("mentions"), "severity": t.get("severity"), "trend_pct": t.get("trend_pct"),
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def _validate(bucket=None, status=None):
    if bucket is not None and bucket not in BUCKETS:
        raise ServiceError(f"bucket must be one of {BUCKETS}")
    if status is not None and status not in STATUSES:
        raise ServiceError(f"status must be one of {STATUSES}")


def list_roadmap(session: Session) -> list[dict]:
    table = stats.theme_table(session)
    ranks = {r["theme_id"]: r for r in priorities.ranking(session, include_praise=True)["items"]}
    out = []
    for item in session.query(RoadmapItem).order_by(RoadmapItem.id).all():
        out.append(_serialize(item, session.get(Theme, item.theme_id), ranks, table))
    return out


def upsert(session: Session, theme_id: int, bucket: str, status: str = "proposed", rationale: str | None = None,
           notes: str | None = None, evidence_links: list[str] | None = None) -> dict:
    _validate(bucket, status)
    theme = session.get(Theme, theme_id)
    if theme is None or theme.merged_into_id is not None:
        raise ServiceError("Theme not found", 404)
    ranks = {r["theme_id"]: r for r in priorities.ranking(session, include_praise=True)["items"]}
    item = session.query(RoadmapItem).filter_by(theme_id=theme_id).first()
    if item is None:
        item = RoadmapItem(theme_id=theme_id, bucket=bucket, status=status,
                           priority_snapshot=ranks.get(theme_id, {}).get("priority"))
        session.add(item)
    item.bucket, item.status = bucket, status
    item.rationale, item.notes = rationale, notes
    item.evidence_links = evidence_links or []
    session.commit()
    stats.invalidate()
    return _serialize(item, theme, ranks, stats.theme_table(session))


def update(session: Session, item_id: int, changes: dict) -> dict:
    item = session.get(RoadmapItem, item_id)
    if item is None:
        raise ServiceError("Roadmap item not found", 404)
    _validate(changes.get("bucket"), changes.get("status"))
    for k in ("bucket", "status", "rationale", "notes", "evidence_links"):
        if k in changes and changes[k] is not None:
            setattr(item, k, changes[k])
    session.commit()
    ranks = {r["theme_id"]: r for r in priorities.ranking(session, include_praise=True)["items"]}
    return _serialize(item, session.get(Theme, item.theme_id), ranks, stats.theme_table(session))


def delete(session: Session, item_id: int) -> None:
    item = session.get(RoadmapItem, item_id)
    if item is None:
        raise ServiceError("Roadmap item not found", 404)
    session.delete(item)
    session.commit()
    stats.invalidate()
