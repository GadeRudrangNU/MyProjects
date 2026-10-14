"""Train and evaluate PayFlow's fraud model on the public ULB credit-card fraud dataset.

Dataset: 284,807 real card transactions from two days in September 2013 (European
cardholders), 492 of them fraudulent. Features V1..V28 are anonymised PCA components.

    python ml/train_fraud_model.py --data ml/data/creditcard.csv

Outputs
    backend/fraud/artifacts/fraud_model.json   serving artifact (standardiser + coefficients + thresholds)
    ml/reports/fraud_model_report.{md,json}    held-out evaluation
    ml/reports/precision_recall.png
    ml/sample/holdout_sample.csv.gz            slice of the held-out period replayed by the traffic simulator

Method
    * Chronological split (70 / 15 / 15 by time): fit on the past, tune on the next slice, report on the
      final slice that was never touched. Random splits overstate performance on time-ordered fraud data.
    * Logistic regression (shipped) vs Isolation Forest (unsupervised baseline).
    * Decision thresholds are chosen on the validation slice by minimising expected cost, because a
      missed fraud and a wrongly blocked customer do not cost the same. The cost assumptions are
      constants below.
"""

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
ARTIFACT = ROOT / "backend" / "fraud" / "artifacts" / "fraud_model.json"
REPORT_DIR = ROOT / "ml" / "reports"
SAMPLE = ROOT / "ml" / "sample" / "holdout_sample.csv.gz"

SIGNALS = [f"V{i}" for i in range(1, 29)]
FEATURES = [*SIGNALS, "log_amount"]

# Cost assumptions (USD). Change them and re-run to move the thresholds.
COST_BLOCK_LEGIT = 10.0  # a legitimate customer declined: lost margin + support contact + churn risk
COST_REVIEW = 2.0  # an analyst spends a minute on a flagged payment; assume the analyst decides correctly
# A fraud that slips through costs the full transaction amount (chargeback).


def load(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["Class"] = df["Class"].astype(int)
    assert df.shape == (284_807, 31), f"unexpected dataset shape {df.shape}"
    assert int(df["Class"].sum()) == 492
    df = df.sort_values("Time", kind="stable").reset_index(drop=True)
    df["log_amount"] = np.log1p(df["Amount"])
    return df


def chronological_split(df: pd.DataFrame):
    n = len(df)
    a, b = int(n * 0.70), int(n * 0.85)
    return df.iloc[:a], df.iloc[a:b], df.iloc[b:]


def confusion(scores, y, threshold):
    flagged = scores >= threshold
    tp = int((flagged & (y == 1)).sum())
    fp = int((flagged & (y == 0)).sum())
    fn = int((~flagged & (y == 1)).sum())
    tn = int((~flagged & (y == 0)).sum())
    return {
        "threshold": float(threshold),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": tp / (tp + fp) if tp + fp else 0.0,
        "recall": tp / (tp + fn) if tp + fn else 0.0,
        "false_positive_rate": fp / (fp + tn) if fp + tn else 0.0,
    }


def policy_cost(scores, y, amount, review_t, block_t):
    """Total cost of acting on the scores: block >= block_t, review in [review_t, block_t), else approve."""
    blocked = scores >= block_t
    reviewed = (scores >= review_t) & ~blocked
    approved = ~blocked & ~reviewed
    return float(
        COST_BLOCK_LEGIT * (blocked & (y == 0)).sum()
        + COST_REVIEW * reviewed.sum()
        + amount[approved & (y == 1)].sum()
    )


def choose_thresholds(scores, y, amount):
    grid = np.unique(np.quantile(scores, 1 - np.logspace(-4.5, -0.3, 200)))
    best = (float("inf"), None, None)
    for review_t in grid:
        for block_t in grid[grid >= review_t]:
            cost = policy_cost(scores, y, amount, review_t, block_t)
            if cost < best[0]:
                best = (cost, float(review_t), float(block_t))
    return best[1], best[2], best[0]


def evaluate(name, scores, y, amount, review_t, block_t):
    return {
        "model": name,
        "pr_auc": float(average_precision_score(y, scores)),
        "roc_auc": float(roc_auc_score(y, scores)),
        "review_or_block": confusion(scores, y, review_t),
        "block": confusion(scores, y, block_t),
        "expected_cost": policy_cost(scores, y, amount, review_t, block_t),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=ROOT / "ml" / "data" / "creditcard.csv")
    args = parser.parse_args()

    df = load(args.data)
    train, val, test = chronological_split(df)
    print(f"rows: train={len(train):,} val={len(val):,} test={len(test):,}")
    print(f"frauds: train={train.Class.sum()} val={val.Class.sum()} test={test.Class.sum()}")

    X_train, X_val, X_test = (d[FEATURES].to_numpy() for d in (train, val, test))
    y_train, y_val, y_test = (d["Class"].to_numpy() for d in (train, val, test))
    amt_val, amt_test = val["Amount"].to_numpy(), test["Amount"].to_numpy()

    scaler = StandardScaler().fit(X_train)
    Z_train, Z_val, Z_test = (scaler.transform(x) for x in (X_train, X_val, X_test))

    # --- logistic regression: pick regularisation by validation PR-AUC -------------------
    best_c, best_ap, lr = None, -1.0, None
    for c in (0.01, 0.1, 1.0, 10.0):
        candidate = LogisticRegression(C=c, max_iter=2000).fit(Z_train, y_train)
        ap = average_precision_score(y_val, candidate.predict_proba(Z_val)[:, 1])
        print(f"  logistic regression C={c}: validation PR-AUC {ap:.4f}")
        if ap > best_ap:
            best_c, best_ap, lr = c, ap, candidate
    lr_val = lr.predict_proba(Z_val)[:, 1]
    lr_test = lr.predict_proba(Z_test)[:, 1]
    review_t, block_t, val_cost = choose_thresholds(lr_val, y_val, amt_val)
    print(f"thresholds (validation): review>={review_t:.5f} block>={block_t:.5f} cost=${val_cost:,.0f}")

    # --- isolation forest baseline (unsupervised, thresholds tuned the same way) ---------------
    iso = IsolationForest(n_estimators=300, random_state=7, n_jobs=-1).fit(Z_train)
    iso_val, iso_test = -iso.score_samples(Z_val), -iso.score_samples(Z_test)
    iso_review, iso_block, _ = choose_thresholds(iso_val, y_val, amt_val)

    results = {
        "logistic_regression": evaluate("logistic_regression", lr_test, y_test, amt_test, review_t, block_t),
        "isolation_forest": evaluate("isolation_forest", iso_test, y_test, amt_test, iso_review, iso_block),
    }
    fraud_total = float(amt_test[y_test == 1].sum())
    baselines = {
        "approve_everything_cost": fraud_total,
        "block_everything_cost": float(COST_BLOCK_LEGIT * (y_test == 0).sum()),
    }
    for r in results.values():
        r["cost_saved_vs_approve_everything"] = fraud_total - r["expected_cost"]

    metrics = {
        "dataset": {
            "name": "ULB credit card fraud detection",
            "rows": len(df), "frauds": int(df.Class.sum()),
            "split": "chronological 70/15/15",
            "train_rows": len(train), "val_rows": len(val), "test_rows": len(test),
            "test_frauds": int(y_test.sum()),
        },
        "cost_assumptions": {
            "block_legitimate_customer": COST_BLOCK_LEGIT,
            "manual_review": COST_REVIEW,
            "missed_fraud": "full transaction amount",
        },
        "regularisation_C": best_c,
        "held_out": {**results, "baselines": baselines},
    }

    # --- artifacts ----------------------------------------------------------------------
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT.write_text(
        json.dumps(
            {
                "model": "logistic_regression",
                "features": FEATURES,
                "mean": scaler.mean_.tolist(),
                "scale": scaler.scale_.tolist(),
                "coef": lr.coef_[0].tolist(),
                "intercept": float(lr.intercept_[0]),
                "review_threshold": review_t,
                "block_threshold": block_t,
                "metrics": {
                    "pr_auc": results["logistic_regression"]["pr_auc"],
                    "roc_auc": results["logistic_regression"]["roc_auc"],
                    "review_or_block": results["logistic_regression"]["review_or_block"],
                    "block": results["logistic_regression"]["block"],
                    "test_rows": len(test),
                    "test_frauds": int(y_test.sum()),
                },
            },
            indent=1,
        )
    )

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / "fraud_model_report.json").write_text(json.dumps(metrics, indent=2))
    (REPORT_DIR / "fraud_model_report.md").write_text(render_report(metrics))

    precision, recall, _ = precision_recall_curve(y_test, lr_test)
    iso_p, iso_r, _ = precision_recall_curve(y_test, iso_test)
    fig, ax = plt.subplots(figsize=(6, 4.2), dpi=140)
    ax.plot(recall, precision, label=f"Logistic regression (AP {results['logistic_regression']['pr_auc']:.2f})")
    ax.plot(iso_r, iso_p, label=f"Isolation forest (AP {results['isolation_forest']['pr_auc']:.2f})")
    ax.axhline(y_test.mean(), color="grey", ls=":", label="Chance (base rate)")
    ax.set(xlabel="Recall", ylabel="Precision", title="Held-out precision-recall", xlim=(0, 1), ylim=(0, 1.02))
    ax.legend(loc="upper right")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(REPORT_DIR / "precision_recall.png")

    # A slice of the held-out period for the traffic simulator: every fraud plus a seeded sample of legitimate rows.
    rng = np.random.default_rng(7)
    legit = test[test.Class == 0]
    sample = pd.concat([test[test.Class == 1], legit.iloc[rng.choice(len(legit), 3000, replace=False)]])
    sample = sample.sort_values("Time")[[*SIGNALS, "Amount", "Class"]].round(6)
    SAMPLE.parent.mkdir(parents=True, exist_ok=True)
    sample.to_csv(SAMPLE, index=False, compression="gzip")
    print(json.dumps(metrics["held_out"]["logistic_regression"], indent=2))


def render_report(m: dict) -> str:
    d, ca = m["dataset"], m["cost_assumptions"]
    lr, iso, base = (m["held_out"][k] for k in ("logistic_regression", "isolation_forest", "baselines"))

    def row(label, c):
        return (
            f"| {label} | {c['threshold']:.5f} | {c['precision']:.3f} | {c['recall']:.3f} | "
            f"{c['false_positive_rate'] * 100:.3f}% | {c['tp']} | {c['fp']} | {c['fn']} | {c['tn']:,} |"
        )

    head = "| Policy | Threshold | Precision | Recall | False-positive rate | TP | FP | FN | TN |\n|---|---|---|---|---|---|---|---|---|"
    return f"""# Fraud model report

Public dataset: ULB credit-card fraud detection, {d['rows']:,} real transactions, {d['frauds']} fraudulent.
Split: {d['split']} (train {d['train_rows']:,} / validation {d['val_rows']:,} / test {d['test_rows']:,}, {d['test_frauds']} frauds in test).
All numbers below are on the **held-out test slice**; thresholds were chosen on the validation slice only.

## Cost model

| Event | Cost |
|---|---|
| Legitimate customer blocked | ${ca['block_legitimate_customer']:.2f} |
| Payment sent to manual review | ${ca['manual_review']:.2f} |
| Fraud that gets through | full transaction amount |

## Shipped model: logistic regression

PR-AUC {lr['pr_auc']:.3f}, ROC-AUC {lr['roc_auc']:.3f}.

{head}
{row('Flag (review or block)', lr['review_or_block'])}
{row('Block', lr['block'])}

Expected cost on the test slice: **${lr['expected_cost']:,.0f}**, against ${base['approve_everything_cost']:,.0f} for approving everything
and ${base['block_everything_cost']:,.0f} for blocking everything.

## Baseline: isolation forest (unsupervised)

PR-AUC {iso['pr_auc']:.3f}, ROC-AUC {iso['roc_auc']:.3f}. Expected cost ${iso['expected_cost']:,.0f}.

{head}
{row('Flag (review or block)', iso['review_or_block'])}
{row('Block', iso['block'])}

The supervised model wins clearly because labelled fraud is available; the isolation forest is kept as a
benchmark and as the starting point if labels were ever scarce.

![Precision-recall](precision_recall.png)

## Caveats

* Features V1-V28 are anonymised PCA components, so the model is served behind an optional `risk_signals`
  field that an upstream signal provider would fill in. PayFlow's own rules (velocity, amount, z-score,
  new device) work without it.
* The data is two days of 2013 European card traffic with 0.17% fraud. Fraud patterns drift; a production
  system would retrain on a schedule and monitor precision/recall on fresh labels.
* The test slice contains only {d['test_frauds']} frauds, so every rate above carries wide uncertainty
  (one fraud more or less moves recall by about two points).
* The cost figures are assumptions, not measurements. Change them in `ml/train_fraud_model.py` and re-run.
"""


if __name__ == "__main__":
    main()
