import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline

from triagepilot.classifier import TicketClassifier
from triagepilot.embeddings import HashEmbedder
from triagepilot.textprep import normalize
from triagepilot.vectorstore import NumpyStore, PgVectorStore

FIXTURE = Path(__file__).parent / "fixtures" / "tickets_small.csv"


@pytest.fixture(scope="module")
def tiny_classifier():
    df = pd.read_csv(FIXTURE)
    pipe = make_pipeline(TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True), CalibratedClassifierCV(LogisticRegression(C=10, max_iter=300), cv=3))
    pipe.fit(df["text"].map(normalize), df["category"])
    return TicketClassifier(pipe)


def test_probabilities_sum_to_one_and_top_k_sorted(tiny_classifier):
    probs = tiny_classifier.predict_proba(["please reset my password i am locked out of my account"])
    assert probs.shape == (1, 8)
    assert abs(probs.sum() - 1) < 1e-6
    top = tiny_classifier.top_k("please reset my password i am locked out of my account", 3)
    assert [p for _, p in top] == sorted((p for _, p in top), reverse=True)
    assert len(top) == 3


def test_classifier_beats_chance_on_its_own_examples(tiny_classifier):
    df = pd.read_csv(FIXTURE).sample(80, random_state=1)
    pred = [tiny_classifier.top_k(t, 1)[0][0] for t in df["text"]]
    assert (np.array(pred) == df["category"].to_numpy()).mean() > 0.5


def test_numpy_store_search_and_split_filter(tmp_path):
    e = HashEmbedder()
    store = NumpyStore(tmp_path)
    rows = [
        {"ref": "a", "text": "printer jam on floor three", "category": "Hardware", "split": "train"},
        {"ref": "b", "text": "printer jam on floor three again", "category": "Hardware", "split": "test"},
        {"ref": "c", "text": "reset password locked account", "category": "Access", "split": "train"},
    ]
    store.replace("ticket", rows, e.encode([r["text"] for r in rows]))
    q = e.encode(["printer jam floor three"])[0]
    assert [h.ref for h in store.search("ticket", q, 2)][0] in ("a", "b")
    assert "b" not in [h.ref for h in store.search("ticket", q, 3, exclude_splits=["test"])]
    assert store.search("missing", q, 3) == []


def test_numpy_store_persists_and_upserts(tmp_path):
    e = HashEmbedder()
    s1 = NumpyStore(tmp_path)
    s1.add("kb", {"ref": "KB1", "text": "first", "meta": {}}, e.encode(["first"])[0])
    s1.add("kb", {"ref": "KB1", "text": "first edited", "meta": {}}, e.encode(["first edited"])[0])
    s1.add("kb", {"ref": "KB2", "text": "second", "meta": {}}, e.encode(["second"])[0])
    s2 = NumpyStore(tmp_path)
    assert s2.count("kb") == 2
    assert s2.search("kb", e.encode(["second"])[0], 1)[0].ref == "KB2"


@pytest.mark.skipif(not os.environ.get("TP_TEST_PGVECTOR_URL"), reason="needs PostgreSQL with pgvector")
def test_pgvector_store_matches_numpy_behaviour():
    e = HashEmbedder()
    store = PgVectorStore(os.environ["TP_TEST_PGVECTOR_URL"], e.dim)
    rows = [
        {"ref": "a", "text": "printer jam on floor three", "category": "Hardware", "split": "train"},
        {"ref": "b", "text": "printer jam on floor three again", "category": "Hardware", "split": "test"},
        {"ref": "c", "text": "reset password locked account", "category": "Access", "split": "train"},
    ]
    store.replace("ticket_test", rows, e.encode([r["text"] for r in rows]))
    q = e.encode(["printer jam floor three"])[0]
    assert store.count("ticket_test") == 3
    assert "b" not in [h.ref for h in store.search("ticket_test", q, 3, ["test"])]
    assert store.search("ticket_test", q, 1)[0].ref in ("a", "b")
