"""Emerging-issue detection: recent window vs. a historical baseline of equal-length windows.

The window length is chosen dynamically from the data (dataset dates may be years old), so the
logic works on any corpus. Counts are also converted to *shares of total volume* so that a
general surge in review volume is not mistaken for a theme-specific problem.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ml import config


@dataclass
class WindowSpec:
    days: int
    anchor: pd.Timestamp
    recent_start: pd.Timestamp
    n_baseline: int
    recent_total: int


def choose_window(dates: pd.Series, candidates=config.TREND_WINDOW_CANDIDATES_DAYS,
                  min_records: int = config.TREND_MIN_WINDOW_RECORDS, n_baseline: int = config.TREND_BASELINE_WINDOWS) -> WindowSpec | None:
    """Smallest window with enough volume AND enough history for `n_baseline` prior windows."""
    dates = pd.to_datetime(dates).dropna()
    if dates.empty:
        return None
    anchor = dates.max().normalize() + pd.Timedelta(days=1)  # exclusive upper bound
    span_days = (anchor - dates.min()).days
    best = None
    for d in candidates:
        if span_days < d * (n_baseline + 1):
            continue
        start = anchor - pd.Timedelta(days=d)
        total = int(((dates >= start) & (dates < anchor)).sum())
        best = WindowSpec(d, anchor, start, n_baseline, total)
        if total >= min_records:
            return best
    return best


def _bin_counts(dates: pd.Series, spec: WindowSpec) -> np.ndarray:
    """Counts per window: index 0 = recent, 1..K = previous windows going back in time."""
    edges = [spec.anchor - pd.Timedelta(days=spec.days * k) for k in range(spec.n_baseline + 2)]
    out = np.zeros(spec.n_baseline + 1, dtype=int)
    for k in range(spec.n_baseline + 1):
        hi, lo = edges[k], edges[k + 1]
        out[k] = int(((dates >= lo) & (dates < hi)).sum())
    return out


def detect_emerging(df: pd.DataFrame, theme_col: str = "theme_id", date_col: str = "created_at",
                    spec: WindowSpec | None = None, smoothing: float = 5.0) -> dict:
    """Return window metadata and per-theme trend statistics.

    Per theme:
      recent_count, baseline_mean, absolute_increase, pct_increase (raw counts),
      share_recent / share_baseline / share_change (volume-adjusted, smoothed),
      z_score (volume-adjusted), flagged (bool) and a human-readable reason.
    """
    dates = pd.to_datetime(df[date_col])
    spec = spec or choose_window(dates)
    if spec is None:
        return {"window": None, "themes": {}}

    totals = _bin_counts(dates, spec)
    recent_total = max(int(totals[0]), 1)
    stats: dict[int, dict] = {}
    for tid, g in df.groupby(theme_col):
        counts = _bin_counts(pd.to_datetime(g[date_col]), spec)
        recent, base = int(counts[0]), counts[1:]
        base_mean = float(base.mean())
        abs_inc = recent - base_mean
        pct_inc = (abs_inc / base_mean) if base_mean > 0 else None
        shares = base / np.maximum(totals[1:], 1)
        s_recent = recent / recent_total
        s_base = float(shares.mean())
        expected = s_base * recent_total
        share_change = (recent + smoothing) / (expected + smoothing) - 1.0
        sd_floor = np.sqrt(max(s_base * (1 - s_base), 1e-12) / recent_total)
        z = (s_recent - s_base) / max(float(shares.std(ddof=1)) if len(shares) > 1 else 0.0, sd_floor)
        flagged = (recent >= config.TREND_MIN_RECENT_COUNT and z >= config.TREND_Z_FLAG
                   and share_change >= config.TREND_MIN_SHARE_INCREASE)
        reason = ""
        if flagged:
            reason = (f"{recent} mentions in the last {spec.days} days vs ~{base_mean:.0f} per prior window "
                      f"(share {100*s_base:.1f}% -> {100*s_recent:.1f}%, z={z:.1f})")
        stats[int(tid)] = {
            "recent_count": recent,
            "baseline_mean": round(base_mean, 2),
            "baseline_counts": base.tolist(),
            "absolute_increase": round(abs_inc, 2),
            "pct_increase": None if pct_inc is None else round(pct_inc, 4),
            "share_recent": round(s_recent, 5),
            "share_baseline": round(s_base, 5),
            "share_change": round(share_change, 4),
            "z_score": round(float(z), 3),
            "flagged": bool(flagged),
            "reason": reason,
        }
    return {
        "window": {
            "days": spec.days,
            "recent_start": str(spec.recent_start.date()),
            "recent_end": str((spec.anchor - pd.Timedelta(days=1)).date()),
            "baseline_windows": spec.n_baseline,
            "recent_total_records": int(totals[0]),
            "baseline_total_records": totals[1:].tolist(),
        },
        "themes": stats,
    }
