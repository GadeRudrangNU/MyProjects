"""Transparent prioritization math. No hidden model: every component is a normalized 0-1 value
and the score is a weighted sum, so each contribution can be shown to the PM.

Priority (0-100) = 100 * sum_i( w_i * c_i ) with weights normalized to sum to 1.

Components (0-1):
  frequency        min-max of log1p(mentions) across the themes being ranked
  severity         theme severity score in [0,1] (PM override maps to a fixed score)
  trend            volume-adjusted growth: clip((share_change + 0.5) / 2.0, 0, 1)
  customer_impact  min-max of log1p(negative mentions) across the ranked themes (unhappy customers reached)
  sentiment        min-max of (1 - mean_sentiment) / 2 across the ranked themes -> 1.0 = most negative theme
  strategic_fit    PM score 0-10 / 10
frequency / customer_impact / sentiment are relative to the current backlog (so they spread the ranking);
severity / trend / strategic_fit are absolute scales.
Business/revenue impact is intentionally absent: the data has no revenue or customer-value fields.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from ml import config

SEVERITY_OVERRIDE_SCORE = {"low": 0.15, "medium": 0.40, "high": 0.70, "critical": 0.95}
COMPONENTS = ("frequency", "severity", "trend", "customer_impact", "sentiment", "strategic_fit")


@dataclass
class ThemeSignals:
    theme_id: int
    mentions: int
    negative_mentions: int
    severity_score: float          # computed mean (0-1)
    mean_sentiment: float          # -1..1
    share_change: float            # volume-adjusted trend, 0.0 = flat
    strategic_fit: float = config.DEFAULT_STRATEGIC_FIT
    severity_override: str | None = None


def normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    w = {k: max(float(weights.get(k, 0.0)), 0.0) for k in COMPONENTS}
    total = sum(w.values())
    if total <= 0:
        return {k: 1.0 / len(COMPONENTS) for k in COMPONENTS}
    return {k: v / total for k, v in w.items()}


def effective_severity(s: ThemeSignals) -> float:
    if s.severity_override:
        return SEVERITY_OVERRIDE_SCORE[s.severity_override]
    return min(max(s.severity_score, 0.0), 1.0)


def trend_component(share_change: float) -> float:
    return min(max((share_change + 0.5) / 2.0, 0.0), 1.0)


def _minmax(values: list[float]) -> list[float]:
    lo, hi = min(values), max(values)
    if hi - lo < 1e-12:
        return [1.0 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


def components_for(signals: list[ThemeSignals]) -> dict[int, dict[str, float]]:
    if not signals:
        return {}
    freq = _minmax([math.log1p(s.mentions) for s in signals])
    impact = _minmax([math.log1p(s.negative_mentions) for s in signals])
    sent = _minmax([(1.0 - s.mean_sentiment) / 2.0 for s in signals])
    out = {}
    for i, s in enumerate(signals):
        out[s.theme_id] = {
            "frequency": freq[i],
            "severity": effective_severity(s),
            "trend": trend_component(s.share_change),
            "customer_impact": impact[i],
            "sentiment": sent[i],
            "strategic_fit": min(max(s.strategic_fit, 0.0), 10.0) / 10.0,
        }
    return out


def score_themes(signals: list[ThemeSignals], weights: dict[str, float]) -> list[dict]:
    """Rank themes. Returns dicts with priority, rank, components and per-component contributions."""
    w = normalize_weights(weights)
    comps = components_for(signals)
    rows = []
    for s in signals:
        c = comps[s.theme_id]
        contrib = {k: round(100.0 * w[k] * c[k], 2) for k in COMPONENTS}
        rows.append({
            "theme_id": s.theme_id,
            "priority": round(sum(contrib.values()), 2),
            "components": {k: round(v, 4) for k, v in c.items()},
            "contributions": contrib,
            "weights": {k: round(v, 4) for k, v in w.items()},
        })
    rows.sort(key=lambda r: (-r["priority"], r["theme_id"]))
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    return rows
