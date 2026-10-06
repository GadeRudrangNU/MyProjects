"""Shared fixtures. API tests run against a throwaway PostgreSQL + pgvector (pgserver), never the app DB."""
from __future__ import annotations

import hashlib
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from langchain_core.embeddings import Embeddings

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


class HashEmbeddings(Embeddings):
    """Deterministic bag-of-words embeddings (384-d, L2-normalized). Similar wording -> similar vectors.
    Used ONLY to keep API tests fast and offline; the embedding pipeline test uses the real model."""

    dim = 384

    def _vec(self, text: str) -> list[float]:
        v = np.zeros(self.dim, dtype=np.float32)
        for tok in text.lower().split():
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            v[h % self.dim] += 1.0
        n = np.linalg.norm(v)
        return (v / n if n else v).tolist()

    def embed_documents(self, texts):
        return [self._vec(t) for t in texts]

    def embed_query(self, text):
        return self._vec(text)


@pytest.fixture(scope="session")
def fake_embedder():
    return HashEmbeddings()


@pytest.fixture(scope="session")
def pg_url(tmp_path_factory):
    pgserver = pytest.importorskip("pgserver")
    server = pgserver.get_server(tmp_path_factory.mktemp("pgdata"), cleanup_mode="stop")
    yield server.get_uri()
    server.cleanup()


TOPICS = {
    1: ("Photo Upload Failure", ["upload", "photo", "crash"], [
        "App crashes whenever I upload a photo", "Uploading an image crashes the app", "Photo upload stopped working after update",
        "Cannot upload pictures it freezes", "Crash when I try to upload photo from gallery", "Upload photo fails with error"]),
    2: ("Login Loop", ["login", "password", "account"], [
        "Login screen keeps looping and never signs me in", "I cannot login my password is rejected", "Stuck in login loop on my account",
        "Sign in fails with correct password", "Account login broken since update", "Login keeps asking for password again"]),
    3: ("Dark Mode Request", ["dark", "mode", "theme"], [
        "Please add a dark mode", "Would love dark theme for night use", "Dark mode would be great",
        "Need a night mode option", "Add dark theme please", "Please make a dark mode"]),
}


@pytest.fixture(scope="session")
def client_env(pg_url, fake_embedder):
    """Create schema + seed a small deterministic corpus; return (TestClient, ids)."""
    os.environ["DATABASE_URL"] = pg_url
    from backend.app import db
    from backend.app.models import Base, Feedback, FeedbackThemeMapping, PriorityWeights, Theme
    from backend.app.services import vectors
    from ml import config, sentiment, severity

    db.get_engine.cache_clear()
    engine = db.get_engine()
    Base.metadata.drop_all(engine)
    db.init_schema(engine)
    store = vectors.get_vector_store(fake_embedder)
    store.delete_collection()
    store.create_collection()

    anchor = datetime(2024, 6, 30)
    S = db.session_factory(engine)
    ids, texts, vecs = [], [], []
    with S() as s:
        for tid, (label, kws, samples) in TOPICS.items():
            cents = np.mean([fake_embedder._vec(t) for t in samples], axis=0)
            cents = cents / np.linalg.norm(cents)
            s.add(Theme(id=tid, generated_label=label, keywords=kws, centroid=cents.tolist(), kind="issue" if tid < 3 else "issue",
                        representative_ids=[]))
        s.add(Theme(id=0, generated_label="Uncategorized", keywords=[], kind="uncategorized"))
        s.add(PriorityWeights(name="default", **config.DEFAULT_WEIGHTS))
        s.flush()
        n = 0
        for tid, (_, _, samples) in TOPICS.items():
            for day in range(0, 300):
                # theme 1 spikes in the final 14 days; others stay flat
                per_day = 1
                if tid == 1 and day >= 286:
                    per_day = 6
                for k in range(per_day):
                    text = samples[(day + k) % len(samples)] + f" v{n}"
                    n += 1
                    created = anchor - timedelta(days=299 - day)
                    rating = 1.0 if tid != 3 else 4.0
                    sc = sentiment.sentiment_score(text, rating)
                    sev, hits = severity.severity_score(text, sc, rating)
                    fid = hashlib.sha1(text.encode()).hexdigest()[:16]
                    s.add(Feedback(id=fid, source="test_fixture", created_at=created, text=text, rating=rating, sentiment=sc,
                                   sentiment_label=sentiment.sentiment_label(sc), severity=severity.level_for(sev),
                                   severity_score=sev, severity_signals=hits, product_area=f"app{tid}", synthetic=True))
                    s.flush()
                    s.add(FeedbackThemeMapping(feedback_id=fid, theme_id=tid, similarity=0.9, assigned_by="model"))
                    ids.append(fid); texts.append(text); vecs.append(fake_embedder._vec(text))
        s.commit()
    vectors.add_vectors(store, ids, texts, vecs, [{"feedback_id": i} for i in ids])

    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.services import stats
    stats.invalidate()
    with TestClient(app) as c:
        yield c, ids
