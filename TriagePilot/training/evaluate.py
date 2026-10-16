"""Compares the classifier, the LLM zero-shot and the hybrid on held-out tickets, by macro-F1.

Usage: python training/evaluate.py [--subset 800] [--no-llm]
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from pydantic import ValidationError
from sklearn.metrics import accuracy_score, classification_report, f1_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agent"))
from triagepilot.classifier import TicketClassifier  # noqa: E402
from triagepilot.config import Settings  # noqa: E402
from triagepilot.embeddings import get_embedder  # noqa: E402
from triagepilot.graph import Deps, choose_category  # noqa: E402
from triagepilot.kb import KnowledgeBase  # noqa: E402
from triagepilot.llm import ZERO_SHOT_SYSTEM, LlmUnavailable, StructuredLlm, zero_shot_prompt  # noqa: E402
from triagepilot.pii import scrub  # noqa: E402
from triagepilot.schemas import CATEGORIES, LlmCategoryChoice, SimilarIncident  # noqa: E402
from triagepilot.vectorstore import get_store  # noqa: E402

OUT = ROOT / "eval"


def metrics(y_true, y_pred) -> dict:
    return {
        "n": len(y_true),
        "accuracy": round(accuracy_score(y_true, y_pred), 4),
        "macro_f1": round(f1_score(y_true, y_pred, average="macro", labels=CATEGORIES, zero_division=0), 4),
    }


def zero_shot(llm: StructuredLlm, text: str) -> str:
    try:
        return llm.run("zero_shot", ZERO_SHOT_SYSTEM, zero_shot_prompt(text), LlmCategoryChoice).category
    except (LlmUnavailable, ValidationError, ValueError):
        return "Miscellaneous"


def evaluate_texts(deps: Deps, rows: list[dict], label: str, exclude: list[str], log) -> tuple[list[dict], dict]:
    """rows: [{text, category}] -> per-row predictions for the three approaches."""
    texts = [scrub(r["text"]) for r in rows]
    probs = deps.classifier.predict_proba(texts)
    vecs = deps.embedder.encode(texts)
    preds = []
    t0 = time.time()
    for i, r in enumerate(rows):
        order = np.argsort(-probs[i])[:3]
        top3 = [(deps.classifier.classes[j], float(probs[i][j])) for j in order]
        hits = deps.store.search("ticket", vecs[i], deps.settings.similar_top_k, exclude)
        similar = [SimilarIncident(ref=h.ref, category=h.category, score=h.score, text=h.text[:300]) for h in hits]
        d = choose_category(deps, texts[i], top3, similar)
        preds.append(
            {
                "truth": r["category"],
                "classifier": top3[0][0],
                "confidence": round(top3[0][1], 4),
                "hybrid": d.category,
                "path": d.path,
                "zero_shot": zero_shot(deps.llm, texts[i]),
            }
        )
        if (i + 1) % 25 == 0:
            log(f"  {label}: {i + 1}/{len(rows)}  {time.time() - t0:.0f}s")
    truth = [p["truth"] for p in preds]
    summary = {k: metrics(truth, [p[k] for p in preds]) for k in ("classifier", "zero_shot", "hybrid")}
    fast = [p for p in preds if p["path"] == "fast"]
    llm = [p for p in preds if p["path"] == "llm"]
    summary["fast_path_share"] = round(len(fast) / len(preds), 4)
    summary["fast_path_accuracy"] = round(accuracy_score([p["truth"] for p in fast], [p["hybrid"] for p in fast]), 4) if fast else None
    if llm:
        summary["llm_path"] = {
            "n": len(llm),
            "classifier_accuracy": round(accuracy_score([p["truth"] for p in llm], [p["classifier"] for p in llm]), 4),
            "hybrid_accuracy": round(accuracy_score([p["truth"] for p in llm], [p["hybrid"] for p in llm]), 4),
        }
    return preds, summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--subset", type=int, default=800)
    ap.add_argument("--model", default=None)
    args = ap.parse_args()
    log = lambda m: print(m, flush=True)  # noqa: E731

    s = Settings()
    if args.model:
        s.llm_model = args.model
    embedder = get_embedder(s)
    store = get_store(s, embedder.dim)
    deps = Deps(s, TicketClassifier.load(s.classifier_path), embedder, store, KnowledgeBase(store, embedder), StructuredLlm(s))
    test = pd.read_csv(ROOT / "data" / "processed" / "test.csv")

    # 1. classifier alone on the whole held-out set
    probs = deps.classifier.predict_proba(test["text"].tolist())
    pred = [deps.classifier.classes[i] for i in probs.argmax(1)]
    full = metrics(test["category"], pred)
    report = classification_report(test["category"], pred, output_dict=True, zero_division=0)
    sweep = []
    conf = probs.max(1)
    correct = np.array(pred) == test["category"].to_numpy()
    for t in (0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95):
        m = conf >= t
        sweep.append({"threshold": t, "coverage": round(float(m.mean()), 4), "accuracy_on_covered": round(float(correct[m].mean()), 4) if m.any() else None})
    log(f"classifier on full held-out set ({len(test)}): {full}")

    # 2. stratified subset for the three-way comparison
    sub = pd.concat([g.sample(frac=args.subset / len(test), random_state=11) for _, g in test.groupby("category")]).reset_index(drop=True)
    rows = [{"text": t, "category": c} for t, c in zip(sub["text"], sub["category"])]
    preds, summary = evaluate_texts(deps, rows, "held-out subset", ["test"], log)
    log(f"subset: {json.dumps(summary, indent=1)}")

    # 3. hand-written natural tickets (index is not filtered; none of them are in it)
    hand = [json.loads(line) for line in (OUT / "handwritten.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    hrows = [{"text": f"{h['short_description']}\n{h['description']}", "category": h["category"]} for h in hand]
    hpreds, hsummary = evaluate_texts(deps, hrows, "hand-written", [], log)
    log(f"hand-written: {json.dumps(hsummary, indent=1)}")

    result = {
        "llm_model": s.llm_model,
        "threshold": s.fast_path_threshold,
        "classifier_full_test": full,
        "classifier_per_class": {k: {m: round(v, 4) for m, v in report[k].items() if m != "support"} | {"support": int(report[k]["support"])} for k in CATEGORIES},
        "threshold_sweep": sweep,
        "subset": {"size": len(rows), **summary},
        "handwritten": {"size": len(hrows), **hsummary},
    }
    OUT.mkdir(exist_ok=True)
    (OUT / "results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    pd.DataFrame(preds).to_csv(OUT / "predictions_subset.csv", index=False)
    pd.DataFrame(hpreds).to_csv(OUT / "predictions_handwritten.csv", index=False)
    log("saved eval/results.json")


if __name__ == "__main__":
    main()
