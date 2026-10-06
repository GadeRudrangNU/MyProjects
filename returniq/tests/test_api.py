import json

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from ml import config
from ml.inference import HISTORY_PATH, MODEL_PATH

client = TestClient(app)
needs_model = pytest.mark.skipif(not (MODEL_PATH.exists() and HISTORY_PATH.exists()), reason="run `make train build-db` first")
needs_db = pytest.mark.skipif(not (config.PROCESSED_DIR / "returniq.db").exists(), reason="run `make build-db` first")

PAYLOAD = {"stock_code": "22423", "quantity": 12, "unit_price": 9.95, "country": "United Kingdom", "order_lines": 10}


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_sample_size_endpoint():
    r = client.post("/api/experiment/sample-size", json={"baseline": 0.06, "relative_reduction": 0.2, "eligible_orders_per_week": 1000})
    assert r.status_code == 200
    j = r.json()
    assert j["n_per_arm"] > 0 and j["weeks_to_enrol"] == pytest.approx(2 * j["n_per_arm"] / 1000)


def test_predict_rejects_invalid_payload():
    assert client.post("/api/predict", json={"stock_code": "22423", "quantity": -1, "unit_price": 1}).status_code == 422
    assert client.post("/api/predict", json={}).status_code == 422


@needs_model
def test_predict_response_schema():
    r = client.post("/api/predict", json=PAYLOAD)
    assert r.status_code == 200
    j = r.json()
    assert 0 <= j["risk"] <= 1 and j["tier"] in {"Low", "Medium", "High"}
    for d in j["drivers"]["increasing"] + j["drivers"]["decreasing"]:
        assert set(d) == {"feature", "label", "display_value", "value", "shap"}
    assert all(d["shap"] > 0 for d in j["drivers"]["increasing"]) and all(d["shap"] < 0 for d in j["drivers"]["decreasing"])


@needs_model
def test_prediction_monotone_in_product_history_signal():
    r = client.post("/api/predict", json={**PAYLOAD, "stock_code": "99999X", "customer_id": 1})
    assert r.status_code == 200 and r.json()["known_product"] is False


@needs_model
def test_shap_values_are_additive():
    import numpy as np
    from ml.features import FEATURES
    from ml.inference import get_scorer
    sc = get_scorer()
    f = sc.features_from_payload(PAYLOAD)
    x = np.array([[f[c] for c in FEATURES]])
    raw = sc.model.predict_proba(x)[0, 1]
    base = float(np.ravel(sc.explainer.expected_value)[-1])
    assert base + sc.shap_values(x)[0].sum() == pytest.approx(raw, abs=1e-6)


@needs_db
def test_orders_listing_and_detail():
    r = client.get("/api/orders", params={"tier": "High", "limit": 3})
    assert r.status_code == 200
    j = r.json()
    assert j["total"] > 0 and all(i["tier"] == "High" for i in j["items"])
    d = client.get(f"/api/orders/{j['items'][0]['line_id']}").json()
    assert d["drivers"]["increasing"] and 0 <= d["risk"] <= 1
    assert client.get("/api/orders/-5").status_code == 404
    assert client.get("/api/orders", params={"sort": "bogus"}).status_code == 400


@needs_db
def test_intervention_endpoint_is_labelled_simulated_and_monotone():
    body = {"scope": "backtest", "top_percent": 5, "effectiveness": 0.2, "cost_per_order": 0.5, "margin": 0.3, "conversion_loss": 0.01}
    a = client.post("/api/simulate-intervention", json=body).json()
    assert "SIMULATED" in a["label"]
    b = client.post("/api/simulate-intervention", json={**body, "top_percent": 20}).json()
    assert b["result"]["targeted_orders"] > a["result"]["targeted_orders"]
    z = client.post("/api/simulate-intervention", json={**body, "effectiveness": 0}).json()
    assert z["result"]["returns_prevented"] == 0 and z["result"]["net_benefit"] < 0


@needs_db
def test_metrics_products_segments():
    m = client.get("/api/metrics").json()
    assert m["observed"]["purchase_lines_modelled"] > 0 and "trend" in m
    p = client.get("/api/products", params={"limit": 5, "sort": "observed_rate", "min_lines": 100}).json()
    assert len(p["items"]) == 5 and p["items"][0]["observed_rate"] >= p["items"][-1]["observed_rate"]
    assert client.get("/api/segments").json()


@pytest.mark.skipif(not (config.REPORTS_DIR / "model_metrics.json").exists(), reason="run `make train` first")
def test_model_metrics_file_is_complete_and_consistent():
    m = client.get("/api/model/metrics").json()
    on_disk = json.loads((config.REPORTS_DIR / "model_metrics.json").read_text())
    assert m == on_disk
    for k in ("roc_auc", "pr_auc", "precision", "recall", "f1", "test_samples"):
        assert k in m
    cm = m["confusion_matrix"]
    assert cm["tn"] + cm["fp"] + cm["fn"] + cm["tp"] == m["test_samples"]
    assert 0.5 < m["roc_auc"] <= 1.0
