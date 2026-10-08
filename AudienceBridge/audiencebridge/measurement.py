from __future__ import annotations

import math

import pandas as pd

from . import bq
from .config import ClientConfig, Settings


def two_proportion_ztest(k1: int, n1: int, k2: int, n2: int) -> tuple[float, float]:
    if n1 <= 0 or n2 <= 0:
        return 0.0, 1.0
    pooled = (k1 + k2) / (n1 + n2)
    se = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
    if se == 0:
        return 0.0, 1.0
    z = (k1 / n1 - k2 / n2) / se
    return z, math.erfc(abs(z) / math.sqrt(2))


def _pick(frame: pd.DataFrame, key: str | None, value, eval_only: bool) -> dict:
    subset = frame if key is None else frame[frame[key] == value]
    if eval_only:
        subset = subset[subset["is_eval"].astype(bool)]
    return {
        "n": int(subset["n"].sum()),
        "k": int(subset["k"].sum()),
        "revenue": float(subset["revenue"].fillna(0).sum()),
    }


def compute_backtest(specs, segment_counts: pd.DataFrame, baseline_counts: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for spec in specs:
        seg = _pick(segment_counts, "segment_name", spec.name, spec.eval_only)
        base = _pick(baseline_counts, None, None, spec.eval_only)
        rest_n, rest_k = base["n"] - seg["n"], base["k"] - seg["k"]
        baseline_rate = base["k"] / base["n"] if base["n"] else 0.0
        rate = seg["k"] / seg["n"] if seg["n"] else 0.0
        _, p_value = two_proportion_ztest(seg["k"], seg["n"], rest_k, rest_n)
        rows.append(
            {
                "segment_name": spec.name,
                "users": seg["n"],
                "purchasers": seg["k"],
                "purchase_rate": rate,
                "baseline_rate": baseline_rate,
                "lift_index": rate / baseline_rate if baseline_rate else None,
                "revenue_per_user": seg["revenue"] / seg["n"] if seg["n"] else 0.0,
                "p_value": p_value,
                "evaluated_on": "held-out users only" if spec.eval_only else "all users",
            }
        )
    return pd.DataFrame(rows)


def compute_aa(specs, aa_counts: pd.DataFrame, alpha: float) -> pd.DataFrame:
    adjusted = alpha / max(len(specs), 1)
    rows = []
    for spec in specs:
        seg = aa_counts[aa_counts["segment_name"] == spec.name]
        hold = seg[seg["is_holdout"].astype(bool)]
        treat = seg[~seg["is_holdout"].astype(bool)]
        n_h, k_h = int(hold["n"].sum()), int(hold["k"].sum())
        n_t, k_t = int(treat["n"].sum()), int(treat["k"].sum())
        z, p = two_proportion_ztest(k_t, n_t, k_h, n_h)
        rows.append(
            {
                "segment_name": spec.name,
                "n_treatment": n_t,
                "n_holdout": n_h,
                "rate_treatment": k_t / n_t if n_t else 0.0,
                "rate_holdout": k_h / n_h if n_h else 0.0,
                "z": z,
                "p_value": p,
                "alpha_adjusted": adjusted,
                "passes": bool(p > adjusted) if n_h and n_t else None,
            }
        )
    return pd.DataFrame(rows)


def assign_holdouts(client, settings: Settings, cfg: ClientConfig) -> None:
    bq.run_sql_file(client, settings, cfg, "measurement/holdout_assignments.sql")


def run(client, settings: Settings, cfg: ClientConfig) -> dict[str, pd.DataFrame]:
    seg_counts = bq.query_file_df(client, settings, cfg, "measurement/backtest_counts.sql")
    base_counts = bq.query_file_df(client, settings, cfg, "measurement/baseline_counts.sql")
    aa_counts = bq.query_file_df(client, settings, cfg, "measurement/aa_counts.sql")

    backtest = compute_backtest(cfg.segments, seg_counts, base_counts)
    aa = compute_aa(cfg.segments, aa_counts, cfg.alpha)

    bq.load_df(client, backtest, bq.table_id(settings, "measurement", "segment_backtest"))
    bq.load_df(client, aa, bq.table_id(settings, "measurement", "aa_test_results"))
    bq.run_sql_file(client, settings, cfg, "measurement/dashboard_summary.sql")
    return {"backtest": backtest, "aa": aa}
