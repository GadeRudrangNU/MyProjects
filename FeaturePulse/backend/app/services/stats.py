"""Theme-level statistics computed from the live database (so PM edits are always reflected).

Results are cached in-process and invalidated by `invalidate()` after any mutating request.
"""
from __future__ import annotations

import threading

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.models import Theme
from ml import config, severity as sev
from ml.priority import ThemeSignals
from ml.trends import choose_window, detect_emerging

_lock = threading.Lock()
_cache: dict = {}


def invalidate() -> None:
    with _lock:
        _cache.clear()


def load_mapped_feedback(session: Session) -> pd.DataFrame:
    rows = session.execute(text(
        "SELECT m.theme_id, f.id AS feedback_id, f.created_at, f.sentiment, f.sentiment_label, f.severity_score, "
        "f.source, f.product_area, f.customer_segment, f.rating "
        "FROM feedback_theme_mapping m JOIN feedback f ON f.id = m.feedback_id"
    )).mappings().all()
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["theme_id", "feedback_id", "created_at", "sentiment", "sentiment_label",
                                     "severity_score", "source", "product_area", "customer_segment", "rating"])
    df["created_at"] = pd.to_datetime(df["created_at"])
    return df


def get_frame(session: Session) -> pd.DataFrame:
    with _lock:
        if "frame" in _cache:
            return _cache["frame"]
    df = load_mapped_feedback(session)
    with _lock:
        _cache["frame"] = df
    return df


def theme_table(session: Session) -> dict:
    """Return {'themes': {id: stats}, 'trend_window': {...}, 'totals': {...}}."""
    with _lock:
        if "table" in _cache:
            return _cache["table"]
    df = get_frame(session)
    themes = {t.id: t for t in session.query(Theme).filter(Theme.merged_into_id.is_(None)).all()}
    # Shares are relative to *all* recent feedback (incl. uncategorized), so use the full frame.
    trend = detect_emerging(df, spec=choose_window(df["created_at"])) if len(df) else {"window": None, "themes": {}}
    out: dict[int, dict] = {}
    for tid, g in df.groupby("theme_id"):
        t = themes.get(int(tid))
        if t is None:
            continue
        neg = g[g.sentiment_label == "negative"]
        base = neg if len(neg) else g
        sev_score = float(base.severity_score.mean()) if len(base) else 0.0
        tr = trend["themes"].get(int(tid), {})
        out[int(tid)] = {
            "id": int(tid),
            "label": t.label,
            "generated_label": t.generated_label,
            "pm_label": t.pm_label,
            "keywords": t.keywords or [],
            "kind": t.kind,
            "ignored": t.ignored,
            "strategic_fit": t.strategic_fit,
            "severity_override": t.severity_override,
            "mentions": int(len(g)),
            "negative_mentions": int(len(neg)),
            "negative_pct": round(100 * len(neg) / len(g), 1),
            "mean_sentiment": round(float(g.sentiment.mean()), 4),
            "mean_rating": None if g.rating.isna().all() else round(float(g.rating.mean()), 2),
            "severity_score": round(sev_score, 4),
            "severity_computed": sev.theme_level_for(sev_score),
            "severity": t.severity_override or sev.theme_level_for(sev_score),
            "trend": tr,
            "trend_pct": None if not tr else round(100 * tr["share_change"], 1),
            "emerging": bool(tr.get("flagged")),
            "first_seen": str(g.created_at.min().date()),
            "last_seen": str(g.created_at.max().date()),
        }
    result = {"themes": out, "trend_window": trend["window"], "total_feedback": int(len(df))}
    with _lock:
        _cache["table"] = result
    return result


def signals_for_ranking(table: dict, include_praise: bool = False) -> list[ThemeSignals]:
    sigs = []
    for t in table["themes"].values():
        if t["ignored"] or t["kind"] == "uncategorized":
            continue
        if t["kind"] == "praise" and not include_praise:
            continue
        sigs.append(ThemeSignals(
            theme_id=t["id"], mentions=t["mentions"], negative_mentions=t["negative_mentions"],
            severity_score=t["severity_score"], mean_sentiment=t["mean_sentiment"],
            share_change=(t["trend"] or {}).get("share_change", 0.0),
            strategic_fit=t["strategic_fit"], severity_override=t["severity_override"],
        ))
    return sigs
