"""Prioritization Service: wraps ml.priority with PM-controlled weights stored in the database."""
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.app.models import PriorityWeights, RoadmapItem
from backend.app.services import stats
from backend.app.services.themes import ServiceError
from ml import config
from ml.priority import COMPONENTS, normalize_weights, score_themes


def get_weights(session: Session) -> dict[str, float]:
    row = session.query(PriorityWeights).filter_by(name="default").first()
    if row is None:
        return dict(config.DEFAULT_WEIGHTS)
    return {k: getattr(row, k) for k in COMPONENTS}


def save_weights(session: Session, weights: dict[str, float]) -> dict[str, float]:
    clean = {k: float(weights.get(k, 0.0)) for k in COMPONENTS}
    if any(v < 0 for v in clean.values()) or sum(clean.values()) <= 0:
        raise ServiceError("Weights must be non-negative and not all zero")
    row = session.query(PriorityWeights).filter_by(name="default").first()
    if row is None:
        row = PriorityWeights(name="default", **clean)
        session.add(row)
    else:
        for k, v in clean.items():
            setattr(row, k, v)
    session.commit()
    return clean


def ranking(session: Session, weights: dict[str, float] | None = None, include_praise: bool = False) -> dict:
    weights = weights or get_weights(session)
    table = stats.theme_table(session)
    scored = score_themes(stats.signals_for_ranking(table, include_praise), weights)
    roadmap = {r.theme_id: r.bucket for r in session.query(RoadmapItem).all()}
    items = []
    for r in scored:
        t = table["themes"][r["theme_id"]]
        items.append({
            **r, "label": t["label"], "mentions": t["mentions"], "negative_mentions": t["negative_mentions"],
            "severity": t["severity"], "severity_overridden": bool(t["severity_override"]),
            "severity_score": t["severity_score"], "trend_pct": t["trend_pct"], "mean_sentiment": t["mean_sentiment"],
            "strategic_fit": t["strategic_fit"], "emerging": t["emerging"], "keywords": t["keywords"][:5],
            "roadmap_bucket": roadmap.get(r["theme_id"]),
            "raw": {"frequency": t["mentions"], "customer_impact": t["negative_mentions"],
                    "severity": t["severity_score"], "trend": t["trend_pct"], "sentiment": t["mean_sentiment"],
                    "strategic_fit": t["strategic_fit"]},
        })
    return {"weights": weights, "normalized_weights": normalize_weights(weights), "items": items,
            "trend_window": table["trend_window"], "excluded": "ignored themes, praise themes and the Uncategorized bucket"
            if not include_praise else "ignored themes and the Uncategorized bucket"}
