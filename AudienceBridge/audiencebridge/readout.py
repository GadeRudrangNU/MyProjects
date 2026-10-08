from __future__ import annotations

import math
from datetime import date
from typing import Any

MIN_LIFT = 1.5
ALPHA = 0.05


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(number) else number


def _int(value: Any) -> int:
    number = _num(value)
    return int(number) if number is not None else 0


def _truthy(value: Any) -> bool:
    try:
        return bool(value)
    except TypeError:
        return False


def _pct(value: Any, digits: int = 1) -> str:
    number = _num(value)
    return "n/a" if number is None else f"{number * 100:.{digits}f}%"


def _lift(value: Any) -> str:
    number = _num(value)
    return "n/a" if number is None else f"{number:.2f}x"


def recommend(row: dict) -> tuple[str, str]:
    if row.get("objective") == "exclude":
        if _truthy(row.get("meets_min")):
            return "Suppress", f"{_int(row.get('activatable_size')):,} recent purchasers can be excluded from campaigns."
        return "Suppress (small)", "Exclusion list is below the minimum size; use rule-based exclusions in Google Ads."
    if not _truthy(row.get("meets_min")):
        return "Hold", (
            f"Only {_int(row.get('activatable_size')):,} activatable members. "
            "Improve CRM match rate or widen the rule before activating."
        )
    lift, p = _num(row.get("lift_index")), _num(row.get("lift_p_value"))
    if lift is not None and lift >= MIN_LIFT and p is not None and p < ALPHA:
        return "Activate", f"Purchased at {_lift(lift)} the baseline rate (p={p:.3g})."
    if lift is not None and lift > 1:
        return "Test", f"Lift of {_lift(lift)} is not clearly significant; run it with the holdout in place."
    return "Do not prioritise", f"Lift of {_lift(lift)} does not beat the baseline."


def render_readout(
    rows: list[dict],
    client_name: str,
    as_of: str,
    future_end: str,
    holdout_pct: int,
    model_metrics: dict | None = None,
    activation_mode: str = "dry_run",
    today: date | None = None,
) -> str:
    today = today or date.today()
    rows = sorted(rows, key=lambda r: _num(r.get("lift_index")) or 0, reverse=True)
    ranked = [(r, *recommend(r)) for r in rows]
    activate = [r for r, decision, _ in ranked if decision == "Activate"]
    aa_failed = [r["segment_name"] for r in rows if r.get("aa_passes") is False]
    total_activatable = sum(_int(r.get("activatable_size")) for r in rows)

    lines = [
        f"# Audience activation readout: {client_name}",
        "",
        f"Prepared {today.isoformat()}. History through {as_of}; outcomes measured through {future_end}.",
        "",
        "## Executive summary",
        "",
        f"- {len(rows)} audiences were built from first-party web and CRM data; "
        f"{len([r for r in rows if _truthy(r.get('meets_min'))])} meet the minimum size for activation.",
        f"- {total_activatable:,} consented, hashed, activatable memberships are ready across all lists.",
    ]
    if activate:
        best = activate[0]
        lines.append(
            f"- Strongest audience: **{best['segment_name']}**, with a purchase rate of "
            f"{_pct(best.get('purchase_rate'))} against a {_pct(best.get('baseline_rate'))} baseline "
            f"({_lift(best.get('lift_index'))} lift)."
        )
        lines.append(f"- Recommended to activate first: {', '.join(r['segment_name'] for r in activate)}.")
    else:
        lines.append(f"- No audience clears the activation bar (lift of at least {MIN_LIFT:.1f}x and p < {ALPHA}) yet.")
    lines += [
        f"- Activation mode for this run: `{activation_mode}`. "
        + ("No data has been sent to Google Ads." if activation_mode == "dry_run" else "Data was sent."),
        "",
        "## Results by audience",
        "",
        "| Audience | Objective | Activatable | Purchase rate | Baseline | Lift | p-value | Decision |",
        "|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for r, decision, _ in ranked:
        p = _num(r.get("lift_p_value"))
        lines.append(
            f"| {r['segment_name']} | {r.get('objective', '')} | {_int(r.get('activatable_size')):,} | "
            f"{_pct(r.get('purchase_rate'))} | {_pct(r.get('baseline_rate'))} | {_lift(r.get('lift_index'))} | "
            f"{'n/a' if p is None else f'{p:.3g}'} | {decision} |"
        )
    lines += ["", "## Recommendations", ""]
    for r, decision, reason in ranked:
        lines.append(f"- **{r['segment_name']}** ({decision}): {reason}")

    lines += [
        "",
        "## Measurement design",
        "",
        f"- {holdout_pct}% of each targeted audience is held out from activation, assigned by a fixed hash so the "
        "split is reproducible.",
        "- Lift compares each audience's purchase rate in the outcome window with the baseline rate across all users.",
    ]
    if aa_failed:
        lines.append(
            "- **Warning:** the A/A check flagged "
            + ", ".join(aa_failed)
            + ". Investigate the holdout split before trusting lift measurement for these audiences."
        )
    else:
        lines.append(
            "- The A/A check passed for every audience: with no ads served, treated and holdout users "
            "purchased at statistically indistinguishable rates, so the split is sound."
        )
    if model_metrics:
        lines.append(
            f"- The purchase-propensity model scored AUC {_num(model_metrics.get('roc_auc')) or 0:.3f} on users it "
            "did not train on."
        )

    lines += [
        "",
        "## Risks and next steps",
        "",
        "- Results are a backtest on historical data. Incremental lift is only proven once a live campaign runs "
        "against the holdout.",
        "- CRM match rate limits audience size; improving identity capture is the main lever for scale.",
        "- Consent is enforced before hashing; only users granting both ad-data and personalisation consent are included.",
        "- Next: create the Customer Match lists in the test account, run a small live flight, and compare treated "
        "against held-out users.",
        "",
    ]
    return "\n".join(lines)
