"""Trains the TF-IDF + logistic regression classifier with calibrated probabilities."""

import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agent"))
from triagepilot.textprep import normalize  # noqa: E402

DATA = ROOT / "data" / "processed"
ART = ROOT / "artifacts"


def build(C: float, class_weight):
    return make_pipeline(
        TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, max_features=300_000),
        LogisticRegression(C=C, class_weight=class_weight, max_iter=400),
    )


def main():
    train = pd.read_csv(DATA / "train.csv")
    X = train["text"].map(normalize)
    y = train["category"]
    Xa, Xv, ya, yv = train_test_split(X, y, test_size=0.15, stratify=y, random_state=7)

    best = None
    for C in (3, 10, 30):
        for cw in (None, "balanced"):
            t = time.time()
            model = build(C, cw).fit(Xa, ya)
            f1 = f1_score(yv, model.predict(Xv), average="macro")
            print(f"C={C:<3} class_weight={cw!s:<9} val macro-F1={f1:.4f} ({time.time() - t:.0f}s)", flush=True)
            if best is None or f1 > best[0]:
                best = (f1, C, cw)
    f1, C, cw = best
    print(f"chosen C={C} class_weight={cw}", flush=True)

    tfidf = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, max_features=300_000)
    base = LogisticRegression(C=C, class_weight=cw, max_iter=400)
    final = make_pipeline(tfidf, CalibratedClassifierCV(base, method="sigmoid", cv=4))
    final.fit(X, y)

    ART.mkdir(exist_ok=True)
    joblib.dump(final, ART / "classifier.joblib")
    (ART / "classifier.json").write_text(
        json.dumps(
            {"C": C, "class_weight": cw, "val_macro_f1": round(f1, 4), "classes": list(final.classes_), "train_rows": len(train)},
            indent=2,
        )
    )
    print("saved", ART / "classifier.joblib")


if __name__ == "__main__":
    main()
