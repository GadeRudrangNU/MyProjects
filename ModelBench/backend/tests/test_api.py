import pytest

from app import db, main, predictors
from app.models import MLModel


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_register_list_delete_model(client):
    r = client.post("/api/models", json={"name": "m1", "hf_id": "keyword:a"})
    assert r.status_code == 201
    assert client.post("/api/models", json={"name": "m1", "hf_id": "keyword:b"}).status_code == 409
    assert [m["name"] for m in client.get("/api/models").json()] == ["m1"]
    assert client.delete(f"/api/models/{r.json()['id']}").status_code == 204
    assert client.delete("/api/models/999").status_code == 404
    assert client.post("/api/models", json={"name": "", "hf_id": "x"}).status_code == 422


def test_run_lifecycle_and_compare(client, keyword_model):
    r = client.post("/api/runs", json={"model_id": keyword_model["id"]})
    assert r.status_code == 202
    run = client.get(f"/api/runs/{r.json()['id']}").json()  # TestClient executes the background task
    assert run["status"] == "completed"
    assert run["model_name"] == "kw"
    assert 0.5 < run["metrics"]["accuracy"] <= 1
    assert "p95" in run["metrics"]["latency_ms"]

    assert len(client.get("/api/runs").json()) == 1
    cmp = client.get("/api/compare", params={"run_ids": [run["id"]]})
    assert cmp.status_code == 200 and cmp.json()[0]["id"] == run["id"]
    assert client.get("/api/compare", params={"run_ids": [999]}).status_code == 404


def test_run_validation(client, keyword_model):
    assert client.post("/api/runs", json={"model_id": 999}).status_code == 404
    assert client.post("/api/runs", json={"model_id": keyword_model["id"], "dataset": "nope"}).status_code == 404
    assert client.get("/api/runs/999").status_code == 404


def test_failed_run_is_recorded(client, offline_hf):
    m = client.post("/api/models", json={"name": "broken", "hf_id": "no-such-org/no-such-model"}).json()
    run_id = client.post("/api/runs", json={"model_id": m["id"]}).json()["id"]
    run = client.get(f"/api/runs/{run_id}").json()
    assert run["status"] == "failed" and run["error"]


def test_dataset_upload_and_use(client, keyword_model):
    csv = "text,label\ngreat stuff,positive\nawful stuff,negative\n"
    up = client.post("/api/datasets", files={"file": ("mini.csv", csv, "text/csv")})
    assert up.status_code == 201 and up.json() == {"name": "mini", "n_samples": 2}
    assert {d["name"] for d in client.get("/api/datasets").json()} == {"sample_sentiment", "mini"}
    run_id = client.post("/api/runs", json={"model_id": keyword_model["id"], "dataset": "mini"}).json()["id"]
    assert client.get(f"/api/runs/{run_id}").json()["metrics"]["n_samples"] == 2


def test_dataset_upload_rejects_bad_input(client):
    bad = client.post("/api/datasets", files={"file": ("x.csv", "a,b\n1,2\n", "text/csv")})
    assert bad.status_code == 422
    big = client.post("/api/datasets", files={"file": ("x.csv", "x" * (2 * 1024 * 1024 + 10), "text/csv")})
    assert big.status_code == 413


def test_predict(client, keyword_model):
    r = client.post("/api/predict", json={"model_id": keyword_model["id"], "text": "I love it"})
    assert r.status_code == 200
    body = r.json()
    assert body["label"] == "positive" and body["latency_ms"] >= 0
    assert client.post("/api/predict", json={"model_id": 999, "text": "x"}).status_code == 404
    assert client.post("/api/predict", json={"model_id": keyword_model["id"], "text": ""}).status_code == 422


def test_predict_surfaces_inference_errors(client, offline_hf):
    m = client.post("/api/models", json={"name": "bad", "hf_id": "no-such-org/no-such-model"}).json()
    assert client.post("/api/predict", json={"model_id": m["id"], "text": "hi"}).status_code == 502


def test_metrics_endpoint_exposes_prometheus(client, keyword_model):
    client.post("/api/predict", json={"model_id": keyword_model["id"], "text": "good"})
    body = client.get("/metrics").text
    assert "inference_latency_seconds_bucket" in body and "http_request_duration_seconds" in body


def test_seed_defaults_only_when_empty(client):
    main.seed_defaults()
    main.seed_defaults()
    s = db.SessionLocal()
    assert s.query(MLModel).count() == len(main.DEFAULT_MODELS)
    s.close()
