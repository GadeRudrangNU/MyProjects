"""End-to-end checks on the synthetic world, where the ground truth is known."""
import json

from fastapi.testclient import TestClient

from wroomcheck.pipeline import build_snapshot
from wroomcheck.summarize import Summarizer


def test_backtest_catches_planted_defects_early(analysis):
    m = analysis.evaluation.metrics
    assert m["recall_pct_addressable"] >= 80
    assert m["lead_weeks_mean"] and m["lead_weeks_mean"] > 8
    assert all(r.lead_days > 0 for r in analysis.evaluation.campaigns if r.status == "early")


def test_silent_recalls_are_not_credited(analysis):
    silent = [r for r in analysis.evaluation.campaigns if not r.addressable]
    assert silent and all(r.status == "missed" for r in silent)


def test_decoy_spikes_cost_precision_but_are_labelled(analysis):
    outcomes = {o.outcome for o in analysis.evaluation.alerts}
    assert "hit" in outcomes and "miss" in outcomes
    assert 40 <= analysis.evaluation.metrics["precision_pct"] <= 100


def test_alerts_use_only_past_data(analysis):
    for o in analysis.evaluation.alerts:
        a = o.alert
        assert a.first_date <= a.alert_date
        assert all(m.date <= a.alert_date for m in a.cluster.members if m.id in a.evidence_ids)


def test_snapshot_and_api(analysis, world, tmp_path, monkeypatch):
    complaints, _ = world
    by_id = {c.id: c for c in complaints}
    snap = build_snapshot(analysis, lambda ids: {i: by_id[i] for i in ids}, Summarizer(None), {"mode": "synthetic"})
    assert snap["metrics"]["summaries"]["final_grounded_pct"] == 100.0
    for a in snap["alerts"]:
        assert a["evidence"] and a["summary"]["grounded"] and "[C" in a["summary"]["text"]

    path = tmp_path / "snapshot.json"
    path.write_text(json.dumps(snap))
    monkeypatch.setenv("WROOM_SNAPSHOT", str(path))
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody:x@127.0.0.1:1/none")
    from wroomcheck import api

    api._cache.clear()
    client = TestClient(api.app)
    assert client.get("/health").json() == {"status": "ok"}
    rows = client.get("/api/alerts").json()
    assert len(rows) == len(snap["alerts"]) and "evidence" not in rows[0]
    one = client.get(f"/api/alerts/{rows[0]['id']}").json()
    assert one["evidence"]
    assert client.get("/api/alerts/9999").status_code == 404
    assert client.get("/api/alerts", params={"outcome": "hit"}).json()
    assert client.get("/api/metrics").json()["campaigns_total"] == snap["metrics"]["campaigns_total"]
    assert client.get("/api/meta").json()["makes"]
    assert client.post("/api/ask", json={"question": "stalling?"}).status_code == 503
