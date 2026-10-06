from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Assumptions:
    effectiveness: float
    cost_per_order: float
    margin: float
    conversion_loss: float
    handling_cost_per_credit: float = 0.0
    credit_fraction: float = 1.0


def select_top_fraction(raw_score: np.ndarray, top_fraction: float) -> np.ndarray:
    n = len(raw_score)
    k = int(round(n * float(np.clip(top_fraction, 0.0, 1.0))))
    mask = np.zeros(n, dtype=bool)
    if k > 0:
        mask[np.argpartition(-raw_score, k - 1)[:k]] = True
    return mask


def simulate(risk: np.ndarray, line_value: np.ndarray, invoice_codes: np.ndarray, customer_ids: np.ndarray,
             targeted: np.ndarray, a: Assumptions, observed_credited_value: np.ndarray | None = None,
             observed_outcome: np.ndarray | None = None) -> dict:
    t = targeted
    n_lines = int(t.sum())
    n_orders = int(len(np.unique(invoice_codes[t]))) if n_lines else 0
    n_customers = int(len(np.unique(customer_ids[t]))) if n_lines else 0

    expected_credits = float(risk[t].sum())
    expected_credit_value = float((risk[t] * line_value[t]).sum() * a.credit_fraction)
    prevented = expected_credits * a.effectiveness
    revenue_preserved = expected_credit_value * a.effectiveness
    margin_preserved = revenue_preserved * a.margin
    handling_saved = prevented * a.handling_cost_per_credit
    kept_value = float(((1.0 - risk[t]) * line_value[t]).sum())
    lost_revenue = kept_value * a.conversion_loss
    margin_lost = lost_revenue * a.margin
    cost = n_orders * a.cost_per_order
    net = margin_preserved + handling_saved - cost - margin_lost
    spend = cost + margin_lost
    out = {
        "targeted_lines": n_lines, "targeted_orders": n_orders, "targeted_customers": n_customers,
        "targeted_value": float(line_value[t].sum()),
        "expected_credits_in_targeted": expected_credits,
        "expected_credit_value_in_targeted": expected_credit_value,
        "returns_prevented": prevented,
        "revenue_preserved": revenue_preserved,
        "margin_preserved": margin_preserved,
        "handling_cost_saved": handling_saved,
        "intervention_cost": cost,
        "conversion_margin_lost": margin_lost,
        "net_benefit": net,
        "roi": (net / spend) if spend > 0 else None,
        "breakeven_effectiveness": None,
    }
    gain_per_unit_eff = expected_credit_value * a.margin + expected_credits * a.handling_cost_per_credit
    if gain_per_unit_eff > 0:
        out["breakeven_effectiveness"] = float(spend / gain_per_unit_eff)
    if observed_outcome is not None and n_lines:
        out["backtest"] = {
            "observed_credited_lines_in_targeted": int(np.nansum(observed_outcome[t])),
            "observed_precision": float(np.nanmean(observed_outcome[t])),
            "observed_credited_value_in_targeted": float(observed_credited_value[t].sum()),
            "share_of_all_observed_credited_value_captured": float(observed_credited_value[t].sum() / max(observed_credited_value.sum(), 1e-9)),
        }
    return out
