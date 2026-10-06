import pytest
from fastapi.testclient import TestClient

from app import datasets, db, predictors
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(datasets, "UPLOAD_DIR", tmp_path / "uploads")
    db.configure("sqlite://")  # fresh in-memory DB per test
    return TestClient(app)  # no `with`: lifespan (seeding) is skipped on purpose


@pytest.fixture()
def keyword_model(client):
    r = client.post("/api/models", json={"name": "kw", "hf_id": "keyword:baseline"})
    return r.json()


@pytest.fixture()
def offline_hf(monkeypatch):
    """Make any real Hugging Face load fail fast instead of touching the network."""
    def boom(self, *a, **k):
        raise OSError("model not found")
    monkeypatch.setattr(predictors.HFPredictor, "__init__", boom)
