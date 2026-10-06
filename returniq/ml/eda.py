from __future__ import annotations

import json

import numpy as np
import pandas as pd

from . import config, data_prep
from .features import FEATURES

LEAKAGE_AUDIT = [
    {"field": "Invoice (the 'C' prefix)", "decision": "EXCLUDED", "reason": "The prefix IS the outcome signal: it identifies credit notes. Used only to build labels and historical rates."},
    {"field": "Quantity < 0", "decision": "EXCLUDED", "reason": "Negative quantity only occurs on credit notes (post-outcome)."},
    {"field": "cancelled_qty / first_cancel_date / lag_days / cancel_fraction", "decision": "EXCLUDED", "reason": "Derived from the matched credit note of the same line - the label itself."},
    {"field": "Invoice number (ordering)", "decision": "EXCLUDED", "reason": "Monotone proxy for time; would let a model memorise the period instead of behaviour."},
    {"field": "Customer ID / StockCode as identifiers", "decision": "EXCLUDED as raw IDs", "reason": "High-cardinality IDs invite memorisation; behaviour is carried by point-in-time history features instead."},
    {"field": "Historical credit-note rates (customer, product)", "decision": "ALLOWED, point-in-time", "reason": "Counted only from credit notes dated strictly before the purchase timestamp; smoothed toward the base rate."},
    {"field": "Quantity, price, order composition, timestamp, country", "decision": "ALLOWED", "reason": "All known at checkout time."},
    {"field": "Credit notes dated within the 30-day window after a purchase", "decision": "EXCLUDED from features", "reason": "Not knowable at purchase time; they are the label. A purge gap of 30 days also separates train/validation/test."},
]


def main() -> None:
    raw = data_prep.load_raw()
    labelled, cancels, prep = data_prep.build_labelled_purchases()
    d = data_prep.standardise(raw)

    missing = {c: {"missing": int(d[c].isna().sum()), "pct": round(float(d[c].isna().mean() * 100), 2)} for c in d.columns}
    dup_all = int(d.duplicated().sum())
    overlap = d[(d["invoice_date"] >= "2010-12-01") & (d["invoice_date"] <= "2010-12-09 12:50")]
    summary: dict = {
        "rows_raw": int(len(d)),
        "date_range": [str(d["invoice_date"].min()), str(d["invoice_date"].max())],
        "unique_invoices": int(d["invoice"].nunique()),
        "unique_customers": int(d["customer_id"].nunique()),
        "unique_products": int(d["stock_code"].nunique()),
        "countries": int(d["country"].nunique()),
        "missing_values": missing,
        "duplicate_rows_exact": dup_all,
        "duplicate_note": "The two source sheets overlap on 2010-12-01..2010-12-09, which accounts for a large share of exact duplicates.",
        "rows_in_sheet_overlap_window": int(len(overlap)),
        "prep_stats": prep,
        "leakage_audit": LEAKAGE_AUDIT,
        "features_used": FEATURES,
    }

    obs = labelled[labelled["observable"]]
    lag = labelled["lag_days"].dropna()
    summary["target"] = {
        "definition": f"y=1 if the purchase line is matched to a credit note (same customer, same product, most-recent-purchase-first) within {config.WINDOW_DAYS} days",
        "observable_lines": int(len(obs)),
        "positive_lines": int(obs["y"].sum()),
        "positive_rate": float(obs["y"].mean()),
        "lag_days_quantiles_all_matched": {str(q): float(lag.quantile(q)) for q in (0.1, 0.25, 0.5, 0.75, 0.9)},
        "share_of_matched_within_7d": float((lag <= 7).mean()),
        "share_of_matched_within_30d": float((lag <= 30).mean()),
        "share_of_matched_within_90d": float((lag <= 90).mean()),
        "matching_coverage": prep["matching"],
    }
    g = obs.groupby("country")["y"].agg(["size", "mean"]).sort_values("size", ascending=False).head(8)
    summary["rate_by_country_top8"] = {k: {"lines": int(v["size"]), "rate": float(v["mean"])} for k, v in g.iterrows()}
    summary["rate_by_hour"] = {int(k): float(v) for k, v in obs.groupby(obs["invoice_date"].dt.hour)["y"].mean().items()}
    summary["rate_by_month"] = {str(k): float(v) for k, v in obs.groupby(obs["invoice_date"].dt.to_period("M").astype(str))["y"].mean().items()}
    config.REPORTS_DIR.mkdir(exist_ok=True)
    (config.REPORTS_DIR / "eda_summary.json").write_text(json.dumps(summary, indent=2, default=str))
    print(json.dumps({k: summary[k] for k in ["rows_raw", "date_range", "unique_invoices", "unique_customers", "unique_products", "duplicate_rows_exact"]}, indent=1))
    print(json.dumps(summary["target"], indent=1))


if __name__ == "__main__":
    main()
