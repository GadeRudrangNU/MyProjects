"""Theme Service: browsing, PM overrides, merging, and feedback re-assignment."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sqlalchemy import update
from sqlalchemy.orm import Session

from backend.app.models import Feedback, FeedbackThemeMapping, RoadmapItem, Theme, ThemeCorrection
from backend.app.services import stats
from ml import severity as sev

SEVERITY_LEVELS = set(sev.LEVEL_ORDER)


class ServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def list_themes(session: Session, q: str | None = None, sentiment: str | None = None, source: str | None = None,
                severity: str | None = None, segment: str | None = None, product_area: str | None = None,
                date_from: str | None = None, date_to: str | None = None, kind: str | None = None,
                include_ignored: bool = False, sort: str = "mentions") -> list[dict]:
    table = stats.theme_table(session)["themes"]
    df = stats.get_frame(session)
    feedback_filters = any([sentiment, source, segment, product_area, date_from, date_to])
    counts: dict[int, tuple[int, int]] | None = None
    if feedback_filters:
        f = df
        if sentiment:
            f = f[f.sentiment_label == sentiment]
        if source:
            f = f[f.source == source]
        if segment:
            f = f[f.customer_segment == segment]
        if product_area:
            f = f[f.product_area == product_area]
        if date_from:
            f = f[f.created_at >= pd.Timestamp(date_from)]
        if date_to:
            f = f[f.created_at < pd.Timestamp(date_to) + pd.Timedelta(days=1)]
        g = f.groupby("theme_id").agg(n=("feedback_id", "size"), neg=("sentiment_label", lambda x: int((x == "negative").sum())))
        counts = {int(i): (int(r.n), int(r.neg)) for i, r in g.iterrows()}
    rows = []
    for t in table.values():
        if t["ignored"] and not include_ignored:
            continue
        if kind and t["kind"] != kind:
            continue
        if severity and t["severity"] != severity:
            continue
        if q and q.lower() not in (t["label"] + " " + " ".join(t["keywords"])).lower():
            continue
        row = {k: v for k, v in t.items() if k != "trend"}
        row["trend_z"] = (t["trend"] or {}).get("z_score")
        row["recent_count"] = (t["trend"] or {}).get("recent_count")
        if counts is not None:
            if t["id"] not in counts:
                continue
            row["filtered_mentions"], row["filtered_negative"] = counts[t["id"]]
        rows.append(row)
    key = {"mentions": lambda r: -(r.get("filtered_mentions", r["mentions"])),
           "trend": lambda r: -(r["trend_pct"] if r["trend_pct"] is not None else -1e9),
           "severity": lambda r: (-sev.LEVEL_ORDER[r["severity"]], -r["severity_score"]),
           "sentiment": lambda r: r["mean_sentiment"],
           "label": lambda r: r["label"].lower()}.get(sort, lambda r: -r["mentions"])
    rows.sort(key=key)
    return rows


def get_theme(session: Session, theme_id: int) -> dict:
    table = stats.theme_table(session)["themes"]
    t = session.get(Theme, theme_id)
    if t is None or t.merged_into_id is not None:
        raise ServiceError("Theme not found", 404)
    base = table.get(theme_id)
    if base is None:  # theme with zero feedback
        base = {"id": t.id, "label": t.label, "generated_label": t.generated_label, "pm_label": t.pm_label,
                "keywords": t.keywords or [], "kind": t.kind, "ignored": t.ignored, "mentions": 0}
    df = stats.get_frame(session)
    g = df[df.theme_id == theme_id]
    rep_ids = t.representative_ids or []
    reps = []
    if rep_ids:
        for f in session.query(Feedback).filter(Feedback.id.in_(rep_ids)).all():
            reps.append({"id": f.id, "text": f.text, "rating": f.rating, "sentiment": f.sentiment_label,
                         "product_area": f.product_area, "created_at": f.created_at.date().isoformat() if f.created_at else None})
    monthly = []
    if len(g):
        m = g.dropna(subset=["created_at"]).set_index("created_at").resample("MS").size()
        monthly = [{"month": i.strftime("%Y-%m"), "count": int(v)} for i, v in m.items()]
    dist = lambda col: [{"name": str(k), "count": int(v)} for k, v in g[col].fillna("unknown").value_counts().head(12).items()]
    related = []
    if t.centroid:
        me = np.array(t.centroid)
        others = session.query(Theme).filter(Theme.id != theme_id, Theme.merged_into_id.is_(None), Theme.centroid.isnot(None)).all()
        sims = sorted(((float(me @ np.array(o.centroid)), o) for o in others), key=lambda x: -x[0])[:5]
        related = [{"id": o.id, "label": o.label, "similarity": round(s, 3)} for s, o in sims]
    return {**base, "representative": reps, "monthly": monthly, "sources": dist("source"),
            "product_areas": dist("product_area"), "segments": dist("customer_segment"),
            "sentiment_breakdown": dist("sentiment_label"), "related_themes": related,
            "notes": t.notes, "severity_signal_note": "Severity = mean rule-based score of negative feedback (see docs)."}


def patch_theme(session: Session, theme_id: int, changes: dict) -> dict:
    t = session.get(Theme, theme_id)
    if t is None or t.merged_into_id is not None:
        raise ServiceError("Theme not found", 404)
    if "label" in changes:
        label = (changes["label"] or "").strip()
        t.pm_label = label or None           # empty string clears the override -> back to generated label
    if "ignored" in changes:
        t.ignored = bool(changes["ignored"])
    if "severity_override" in changes:
        v = changes["severity_override"]
        if v not in (None, "") and v not in SEVERITY_LEVELS:
            raise ServiceError(f"severity_override must be one of {sorted(SEVERITY_LEVELS)} or null")
        t.severity_override = v or None
    if "strategic_fit" in changes:
        v = float(changes["strategic_fit"])
        if not 0 <= v <= 10:
            raise ServiceError("strategic_fit must be between 0 and 10")
        t.strategic_fit = v
    if "notes" in changes:
        t.notes = changes["notes"]
    session.commit()
    stats.invalidate()
    return get_theme(session, theme_id)


def merge_themes(session: Session, source_ids: list[int], target_id: int, label: str | None = None) -> dict:
    target = session.get(Theme, target_id)
    if target is None or target.merged_into_id is not None:
        raise ServiceError("Target theme not found", 404)
    sources = [i for i in dict.fromkeys(source_ids) if i != target_id]
    if not sources:
        raise ServiceError("Provide at least one source theme different from the target")
    moved = 0
    cents = [(np.array(target.centroid), session.query(FeedbackThemeMapping).filter_by(theme_id=target_id).count())] if target.centroid else []
    for sid in sources:
        s = session.get(Theme, sid)
        if s is None or s.merged_into_id is not None:
            raise ServiceError(f"Source theme {sid} not found", 404)
        if "uncategorized" in (s.kind, target.kind):
            raise ServiceError("The Uncategorized bucket cannot be merged")
        n = session.query(FeedbackThemeMapping).filter_by(theme_id=sid).count()
        if s.centroid:
            cents.append((np.array(s.centroid), n))
        session.execute(update(FeedbackThemeMapping).where(FeedbackThemeMapping.theme_id == sid)
                        .values(theme_id=target_id, assigned_by="pm"))
        moved += n
        s.merged_into_id = target_id
        item = session.query(RoadmapItem).filter_by(theme_id=sid).first()
        if item:
            if session.query(RoadmapItem).filter_by(theme_id=target_id).first():
                session.delete(item)
            else:
                item.theme_id = target_id
        target.keywords = list(dict.fromkeys((target.keywords or []) + (s.keywords or [])))[:10]
    if cents:
        w = np.array([c[1] for c in cents], dtype=float)
        agg = sum(c[0] * wi for c, wi in zip(cents, w)) / max(w.sum(), 1)
        target.centroid = [float(x) for x in agg / max(np.linalg.norm(agg), 1e-12)]
    if label:
        target.pm_label = label.strip()
    session.commit()
    stats.invalidate()
    return {"target_id": target_id, "merged": sources, "feedback_moved": moved}


def correct_theme(session: Session, feedback_id: str, new_theme_id: int) -> dict:
    m = session.get(FeedbackThemeMapping, feedback_id)
    if m is None:
        raise ServiceError("Feedback not found", 404)
    new = session.get(Theme, new_theme_id)
    if new is None or new.merged_into_id is not None:
        raise ServiceError("Target theme not found", 404)
    if m.theme_id == new_theme_id:
        raise ServiceError("Feedback is already assigned to that theme")
    session.add(ThemeCorrection(feedback_id=feedback_id, old_theme=m.theme_id, new_theme=new_theme_id))
    old = m.theme_id
    m.theme_id = new_theme_id
    m.assigned_by = "pm"
    session.commit()
    stats.invalidate()
    return {"feedback_id": feedback_id, "old_theme": old, "new_theme": new_theme_id}
