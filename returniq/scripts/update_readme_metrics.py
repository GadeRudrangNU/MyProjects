from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
METRICS = ROOT / "reports" / "model_metrics.json"
DB = ROOT / "data" / "processed" / "returniq.db"


def pct(x, d=1):
    return f"{x * 100:.{d}f}%"


def model_block(m: dict) -> str:
    cm = m["confusion_matrix"]
    rows = [
        f"**Selected model:** `{m['selected_model']}` (highest validation PR-AUC; test period touched once). "
        f"**Held-out test:** {m['test_samples']:,} purchase lines, {m['positives']:,} positives ({pct(m['base_rate'], 2)} base rate).",
        "",
        "| Metric | Value | Note |", "|---|---|---|",
        f"| ROC-AUC | **{m['roc_auc']:.3f}** | 0.5 = chance |",
        f"| PR-AUC | **{m['pr_auc']:.3f}** | baseline for a random ranker = {m['base_rate']:.3f} |",
        f"| Precision | {pct(m['precision'])} | at the F1-optimal threshold chosen on validation ({m['threshold']:.3f}) |",
        f"| Recall | {pct(m['recall'])} | same threshold |",
        f"| F1 | {m['f1']:.3f} | same threshold |",
        f"| Brier score | {m['brier']:.4f} | after sigmoid calibration (uncalibrated: {m['brier_uncalibrated']:.4f}) |",
        f"| Confusion matrix | TN {cm['tn']:,} · FP {cm['fp']:,} · FN {cm['fn']:,} · TP {cm['tp']:,} | |",
        "",
        "**Ranking value (what the product uses):**", "",
        "| Flag top… | Lines flagged | Precision | Recall (of all credits) | Lift vs. base rate |", "|---|---|---|---|---|",
    ]
    for t in m["top_k"]:
        rows.append(f"| {t['top_fraction'] * 100:.0f}% | {t['n_flagged']:,} | {pct(t['precision'])} | {pct(t['recall'])} | {t['lift']:.1f}× |")
    rows += ["", "**Risk tiers** (cut-offs set on validation scores):", "", "| Tier | Share of lines | Observed credit rate | Share of all credits |", "|---|---|---|---|"]
    for k in ("High", "Medium", "Low"):
        t = m["tiers"][k]
        rows.append(f"| {k} | {pct(t['share_of_lines'])} | {pct(t['observed_rate'], 2)} | {pct(t['share_of_all_positives'], 0)} |")
    rows += ["", "**Model comparison** (validation is the selection set; test shown for transparency, *not* used to select):", "",
             "| Model | Val ROC-AUC | Val PR-AUC | Test ROC-AUC | Test PR-AUC |", "|---|---|---|---|---|"]
    for name, c in m["comparison"].items():
        rows.append(f"| {name} | {c['validation']['roc_auc']:.3f} | {c['validation']['pr_auc']:.3f} | {c['test']['roc_auc']:.3f} | {c['test']['pr_auc']:.3f} |")
    rows += ["", f"_Generated from `reports/model_metrics.json` at {m['generated_at']}._"]
    return "\n".join(rows)


def observed_block() -> str:
    if not DB.exists():
        return "_Run `make build-db` to populate observed metrics._"
    con = sqlite3.connect(DB)
    o = json.loads(con.execute("SELECT value FROM kv WHERE key='observed'").fetchone()[0])
    rows = ["| Observed metric (descriptive, this dataset) | Value |", "|---|---|",
            f"| Purchase lines modelled / invoices / customers | {o['purchase_lines_modelled']:,} / {o['invoices_total']:,} / {o['customers']:,} |",
            f"| 30-day credit-note rate (lines with a complete window) | {pct(o['line_credit_rate_30d'], 2)} ({o['credited_lines_30d']:,} of {o['observable_lines']:,}) |",
            f"| Orders with ≥1 credited line within 30 days | {pct(o['order_credit_rate_30d'])} |",
            f"| **30-day retained purchase rate — observed proxy** | **{pct(o['retained_purchase_rate_30d_orders'], 2)}** of orders · {pct(o['retained_purchase_rate_30d_lines'], 2)} of lines |",
            f"| Value credited within 30 days | £{o['credited_value_30d']:,.0f} ({pct(o['value_credit_rate_30d'], 2)} of £{o['revenue_observable']:,.0f}) |",
            f"| Average order value | £{o['avg_order_value']:,.2f} |",
            f"| Customers with 2+ orders | {pct(o['repeat_customer_rate'], 0)} (mean {o['orders_per_customer_mean']:.1f} orders/customer) |",
            "| Exchange rate | not measurable (no exchange flag) |"]
    s = o["scored"]
    rows += ["", f"Held-out-period check of the value-at-risk formula: expected £{s['value_at_risk_test_expected']:,.0f} vs. £{s['credited_value_test_observed']:,.0f} actually credited. "
             f"Open window (outcomes pending): {s['high_risk_lines_pending']:,} high-risk lines, expected value at risk £{s['value_at_risk_pending']:,.0f}."]
    return "\n".join(rows)


def replace(text: str, tag: str, body: str) -> str:
    pat = re.compile(rf"(<!-- {tag}:START -->)(.*?)(<!-- {tag}:END -->)", re.S)
    if not pat.search(text):
        print(f"README.md has no {tag} markers; skipping that block")
        return text
    return pat.sub(lambda mo: f"{mo.group(1)}\n{body}\n{mo.group(3)}", text)


def main() -> None:
    if not METRICS.exists():
        raise SystemExit("reports/model_metrics.json not found - run `make train` first")
    m = json.loads(METRICS.read_text())
    text = README.read_text(encoding="utf-8")
    text = replace(text, "METRICS", model_block(m))
    text = replace(text, "OBSERVED", observed_block())
    README.write_text(text, encoding="utf-8")
    print("README.md metrics updated from", METRICS.name)


if __name__ == "__main__":
    main()
