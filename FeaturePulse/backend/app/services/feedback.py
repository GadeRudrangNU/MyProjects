"""Feedback Service: listing/filtering and detail views."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.app.models import Feedback, FeedbackThemeMapping, Theme, ThemeCorrection
from backend.app.services.themes import ServiceError


def _serialize(f: Feedback, theme: Theme | None, mapping: FeedbackThemeMapping | None) -> dict:
    return {
        "id": f.id, "source": f.source, "created_at": f.created_at.date().isoformat() if f.created_at else None,
        "customer_segment": f.customer_segment, "text": f.text, "rating": f.rating,
        "sentiment": f.sentiment_label, "sentiment_score": None if f.sentiment is None else round(f.sentiment, 3),
        "severity": f.severity, "severity_score": None if f.severity_score is None else round(f.severity_score, 3),
        "product_area": f.product_area, "synthetic": f.synthetic,
        "theme_id": theme.id if theme else None, "theme_label": theme.label if theme else None,
        "assigned_by": mapping.assigned_by if mapping else None,
        "similarity_to_theme": None if not mapping or mapping.similarity is None else round(mapping.similarity, 3),
    }


def list_feedback(session: Session, q: str | None = None, theme_id: int | None = None, sentiment: str | None = None,
                  source: str | None = None, severity: str | None = None, segment: str | None = None,
                  product_area: str | None = None, date_from: str | None = None, date_to: str | None = None,
                  page: int = 1, page_size: int = 25) -> dict:
    page_size = min(max(page_size, 1), 200)
    stmt = (select(Feedback, Theme, FeedbackThemeMapping)
            .join(FeedbackThemeMapping, FeedbackThemeMapping.feedback_id == Feedback.id)
            .join(Theme, Theme.id == FeedbackThemeMapping.theme_id))
    if q:
        stmt = stmt.where(Feedback.text.ilike(f"%{q}%"))
    if theme_id is not None:
        stmt = stmt.where(FeedbackThemeMapping.theme_id == theme_id)
    if sentiment:
        stmt = stmt.where(Feedback.sentiment_label == sentiment)
    if source:
        stmt = stmt.where(Feedback.source == source)
    if severity:
        stmt = stmt.where(Feedback.severity == severity)
    if segment:
        stmt = stmt.where(Feedback.customer_segment == segment)
    if product_area:
        stmt = stmt.where(Feedback.product_area == product_area)
    try:
        if date_from:
            stmt = stmt.where(Feedback.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            stmt = stmt.where(Feedback.created_at < datetime.fromisoformat(date_to) + timedelta(days=1))
    except ValueError:
        raise ServiceError("Dates must be ISO formatted (YYYY-MM-DD)")
    total = session.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = session.execute(stmt.order_by(Feedback.created_at.desc().nullslast(), Feedback.id)
                           .limit(page_size).offset((page - 1) * page_size)).all()
    return {"total": total, "page": page, "page_size": page_size,
            "items": [_serialize(f, t, m) for f, t, m in rows]}


def get_feedback(session: Session, feedback_id: str) -> dict:
    row = session.execute(
        select(Feedback, Theme, FeedbackThemeMapping)
        .join(FeedbackThemeMapping, FeedbackThemeMapping.feedback_id == Feedback.id)
        .join(Theme, Theme.id == FeedbackThemeMapping.theme_id).where(Feedback.id == feedback_id)).first()
    if row is None:
        raise ServiceError("Feedback not found", 404)
    f, t, m = row
    out = _serialize(f, t, m)
    out["severity_signals"] = f.severity_signals or {}
    out["metadata"] = f.meta
    out["corrections"] = [
        {"old_theme": c.old_theme, "new_theme": c.new_theme, "timestamp": c.timestamp.isoformat()}
        for c in session.query(ThemeCorrection).filter_by(feedback_id=feedback_id).order_by(ThemeCorrection.id).all()]
    return out


def filter_options(session: Session) -> dict:
    def distinct(col):
        return sorted(v for (v,) in session.execute(select(col).distinct()).all() if v)
    return {"sources": distinct(Feedback.source), "product_areas": distinct(Feedback.product_area),
            "segments": distinct(Feedback.customer_segment), "sentiments": ["negative", "neutral", "positive"],
            "severities": ["low", "medium", "high", "critical"]}
