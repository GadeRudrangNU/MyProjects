from __future__ import annotations

import json
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix,
                             f1_score, precision_score, recall_score, roc_auc_score)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import QuantileTransformer
from xgboost import XGBClassifier

from . import config, data_prep
from .calibration import SigmoidCalibrator
from .features import FEATURES, build_features


def chronological_split(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    gap = pd.Timedelta(days=config.WINDOW_DAYS)
    train_end, val_end = pd.Timestamp(config.TRAIN_END) + pd.Timedelta(days=1), pd.Timestamp(config.VAL_END) + pd.Timedelta(days=1)
    d = df["invoice_date"]
    obs = df["observable"]
    return {
        "train": df[(d < train_end) & obs],
        "val": df[(d >= train_end + gap) & (d < val_end) & obs],
        "test": df[(d >= val_end + gap) & obs],
        "pending": df[~obs],
    }


def topk_stats(y: np.ndarray, score: np.ndarray, frac: float) -> dict:
    k = max(int(len(y) * frac), 1)
    idx = np.argsort(-score)[:k]
    prec = float(y[idx].mean())
    return {"top_fraction": frac, "n_flagged": int(k), "precision": prec,
            "recall": float(y[idx].sum() / max(y.sum(), 1)), "lift": prec / max(float(y.mean()), 1e-12)}


def best_f1_threshold(y: np.ndarray, p: np.ndarray) -> float:
    grid = np.unique(np.quantile(p, np.linspace(0.5, 0.999, 200)))
    f1s = [f1_score(y, p >= t, zero_division=0) for t in grid]
    return float(grid[int(np.argmax(f1s))])


def evaluate(y: np.ndarray, p: np.ndarray, threshold: float) -> dict:
    pred = (p >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "roc_auc": float(roc_auc_score(y, p)),
        "pr_auc": float(average_precision_score(y, p)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "threshold": float(threshold),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "brier": float(brier_score_loss(y, np.clip(p, 0, 1))),
        "test_samples": int(len(y)),
        "positives": int(y.sum()),
        "base_rate": float(y.mean()),
    }


def candidates() -> dict:
    rs = config.RANDOM_STATE
    return {
        "logistic_regression": make_pipeline(
            QuantileTransformer(n_quantiles=200, output_distribution="normal", random_state=rs),
            LogisticRegression(C=0.5, max_iter=500, class_weight="balanced")),
        "random_forest": RandomForestClassifier(
            n_estimators=150, max_depth=8, min_samples_leaf=100, max_features="sqrt",
            class_weight="balanced_subsample", n_jobs=-1, random_state=rs),
        "hist_gradient_boosting": HistGradientBoostingClassifier(
            max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=100,
            l2_regularization=1.0, early_stopping=True, validation_fraction=0.1, random_state=rs),
        "xgboost": XGBClassifier(
            n_estimators=400, learning_rate=0.05, max_depth=5, subsample=0.8, colsample_bytree=0.8,
            min_child_weight=20, reg_lambda=2.0, tree_method="hist", eval_metric="aucpr",
            n_jobs=-1, random_state=rs),
    }


def main() -> None:
    t0 = time.time()
    config.REPORTS_DIR.mkdir(exist_ok=True)
    config.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    labelled, cancels, prep_stats = data_prep.build_labelled_purchases()
    feats = build_features(labelled, cancels)
    feats.to_parquet(config.INTERIM_DIR / "features.parquet")
    splits = chronological_split(feats)
    tr, va, te = splits["train"], splits["val"], splits["test"]
    split_summary = {
        name: {"rows": int(len(s)), "positives": int(s["y"].sum()) if name != "pending" else None,
               "base_rate": float(s["y"].mean()) if name != "pending" else None,
               "start": str(s["invoice_date"].min()), "end": str(s["invoice_date"].max())}
        for name, s in splits.items()}
    print(json.dumps(split_summary, indent=1))

    Xtr, ytr = tr[FEATURES].to_numpy(), tr["y"].to_numpy()
    Xva, yva = va[FEATURES].to_numpy(), va["y"].to_numpy()
    Xte, yte = te[FEATURES].to_numpy(), te["y"].to_numpy()

    comparison: dict[str, dict] = {}
    fitted: dict = {}
    comparison["heuristic_product_history"] = {
        "validation": {"roc_auc": float(roc_auc_score(yva, va["prod_prior_cancel_rate"])),
                       "pr_auc": float(average_precision_score(yva, va["prod_prior_cancel_rate"]))},
        "test": {"roc_auc": float(roc_auc_score(yte, te["prod_prior_cancel_rate"])),
                 "pr_auc": float(average_precision_score(yte, te["prod_prior_cancel_rate"]))},
        "note": "Single-feature rule (product's smoothed historical credit-note rate); not a trained model.",
    }
    for name, model in candidates().items():
        s = time.time()
        model.fit(Xtr, ytr)
        pva, pte = model.predict_proba(Xva)[:, 1], model.predict_proba(Xte)[:, 1]
        comparison[name] = {
            "validation": {"roc_auc": float(roc_auc_score(yva, pva)), "pr_auc": float(average_precision_score(yva, pva))},
            "test": {"roc_auc": float(roc_auc_score(yte, pte)), "pr_auc": float(average_precision_score(yte, pte))},
            "fit_seconds": round(time.time() - s, 1),
        }
        fitted[name] = model
        print(name, comparison[name])

    selected = max(fitted, key=lambda n: comparison[n]["validation"]["pr_auc"])
    print("SELECTED (validation PR-AUC):", selected)
    model = fitted[selected]

    pva_raw = model.predict_proba(Xva)[:, 1]
    calibrator = SigmoidCalibrator().fit(pva_raw, yva)
    pva = calibrator.predict(pva_raw)
    pte_raw = model.predict_proba(Xte)[:, 1]
    pte = calibrator.predict(pte_raw)

    thr = best_f1_threshold(yva, pva)
    high_cut = float(np.quantile(pva_raw, 1 - config.HIGH_RISK_QUANTILE))
    cuts = {"raw_medium": float(np.quantile(pva_raw, 0.70)), "raw_high": float(np.quantile(pva_raw, 0.90))}
    tier = np.where(pte_raw >= cuts["raw_high"], "High", np.where(pte_raw >= cuts["raw_medium"], "Medium", "Low"))
    tier_table = {}
    for t in ["High", "Medium", "Low"]:
        m = tier == t
        tier_table[t] = {"orders_lines": int(m.sum()), "share_of_lines": float(m.mean()),
                         "observed_rate": float(yte[m].mean()) if m.any() else None,
                         "share_of_all_positives": float(yte[m].sum() / max(yte.sum(), 1))}

    m = evaluate(yte, pte, thr)
    ref_pr = evaluate(yte, pte_raw, best_f1_threshold(yva, pva_raw))
    frac, mean_pred = calibration_curve(yte, pte, n_bins=10, strategy="quantile")
    cal_raw_frac, cal_raw_pred = calibration_curve(yte, np.clip(pte_raw, 0, 1), n_bins=10, strategy="quantile")
    metrics = {
        **{k: m[k] for k in ["roc_auc", "pr_auc", "precision", "recall", "f1", "test_samples"]},
        "selected_model": selected,
        "selection_rule": "highest validation PR-AUC among candidates",
        "calibration_method": "sigmoid (Platt) scaling fitted on the validation period",
        "label": f"purchase line matched to a credit note within {config.WINDOW_DAYS} days",
        "threshold_rule": "probability threshold maximising F1 on the validation period",
        **{k: m[k] for k in ["threshold", "confusion_matrix", "brier", "positives", "base_rate"]},
        "brier_uncalibrated": ref_pr["brier"],
        "top_k": [topk_stats(yte, pte_raw, f) for f in (0.01, 0.05, 0.10, 0.20)],
        "tiers": tier_table,
        "tier_cutoffs_raw_score": cuts,
        "calibration": {"observed": frac.tolist(), "predicted": mean_pred.tolist(),
                        "uncalibrated_observed": cal_raw_frac.tolist(), "uncalibrated_predicted": cal_raw_pred.tolist()},
        "splits": split_summary,
        "comparison": comparison,
        "generated_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "random_state": config.RANDOM_STATE,
    }
    (config.REPORTS_DIR / "model_metrics.json").write_text(json.dumps(metrics, indent=2))
    (config.REPORTS_DIR / "data_prep_stats.json").write_text(json.dumps(prep_stats, indent=2))

    joblib.dump({"model": model, "calibrator": calibrator, "features": FEATURES, "name": selected,
                 "cuts": cuts, "threshold": thr, "medians": tr[FEATURES].median().to_dict()},
                config.MODEL_DIR / "model.joblib")
    print(json.dumps({k: metrics[k] for k in ["selected_model", "roc_auc", "pr_auc", "precision", "recall", "f1", "test_samples", "brier", "brier_uncalibrated"]}, indent=1))
    print("tiers", json.dumps(tier_table, indent=1)); print("topk", metrics["top_k"])
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
