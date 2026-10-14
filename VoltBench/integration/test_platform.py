"""Runs against a live stack started with scripts/stack.py."""

import time

import httpx
import pytest

GATEWAY = "http://127.0.0.1:8080"
LAB = "http://127.0.0.1:9100"


@pytest.fixture(scope="module")
def http():
    client = httpx.Client(base_url=GATEWAY, timeout=20)
    try:
        client.get("/readyz").raise_for_status()
    except httpx.HTTPError:
        pytest.skip("platform is not running")
    yield client
    httpx.delete(f"{LAB}/faults")
    client.close()


def wait_for(fn, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = fn()
        if result:
            return result
        time.sleep(0.5)
    raise AssertionError("condition not met in time")


def test_devices_stream_and_report_status(http):
    devices = http.get("/api/devices").json()
    assert len(devices) >= 3
    assert {d["type"] for d in devices} == {"BMU", "BCM", "TCM"}
    assert all(d["status"] == "ONLINE" for d in devices[:3])


def test_command_is_acknowledged_and_telemetry_is_stored(http):
    res = http.post("/api/devices/1/commands", json={"cmd": "GET_VERSION"}).json()
    assert res["ack"] and res["data"]["version"] == "2.4.1"
    assert res["latency_ms"] < 100
    now = int(time.time() * 1000)
    points = wait_for(lambda: http.get("/api/devices/1/telemetry", params={"from": now - 3000, "to": now + 5000, "signal": "cell_v_1"}).json())
    assert all(p["signal"] == "cell_v_1" for p in points)
    assert 3.6 < points[-1]["value"] < 4.2


def test_unsupported_command_is_rejected(http):
    res = http.post("/api/devices/1/commands", json={"cmd": "SET_OUTPUT", "args": {"channel": 1, "state": "on"}})
    assert res.status_code == 400


def test_invalid_definition_is_rejected_with_a_line(http):
    bad = "name: broken_test\nkind: custom\ndevice_type: BCM\nversion: 1\nsteps:\n  - assert: \"x >\"\n"
    res = http.post("/api/test-definitions", content=bad, headers={"Content-Type": "text/plain"})
    assert res.status_code == 422
    assert res.json()["errors"][0]["line"] == 6


def test_definition_round_trip_and_duplicate_version(http):
    name = f"integration_{int(time.time())}"
    spec = f"name: {name}\nkind: custom\ndevice_type: ANY\nversion: 1\nsteps:\n  - sleep_ms: 10\n"
    assert http.post("/api/test-definitions", content=spec).status_code == 201
    assert http.post("/api/test-definitions", content=spec).status_code == 409


def test_injected_fault_is_flagged_by_a_test_and_raises_an_alert(http):
    since = int(time.time() * 1000)
    httpx.post(f"{LAB}/faults", json={"device_id": 1, "type": "wrong_firmware", "duration_s": 60})
    httpx.post(f"{LAB}/faults", json={"device_id": 4, "type": "hang", "duration_s": 60})
    plans = http.get("/api/test-plans").json()
    quick = next(p for p in plans if p["name"] == "quick_health")
    run_id = http.post("/api/test-runs", json={"plan_id": quick["id"], "device_ids": [1, 2, 4]}).json()["run_id"]
    detail = wait_for(lambda: (r := http.get(f"/api/test-runs/{run_id}").json())["run"]["status"] == "completed" and r, 90)
    verdicts = {(r["device_id"], r["test"]): r["verdict"] for r in detail["results"]}
    assert verdicts[(1, "firmware_check")] == "FAIL"
    assert verdicts[(2, "firmware_check")] == "PASS"
    assert verdicts[(4, "ack_latency")] == "FAIL"
    assert "ERROR" not in verdicts.values()
    alerts = wait_for(lambda: [a for a in http.get("/api/alerts", params={"device_id": 4, "since": since}).json() if a["rule"] == "stale_signal"])
    assert alerts
    csv = http.get(f"/api/test-runs/{run_id}/report.csv")
    assert csv.status_code == 200 and "firmware_check" in csv.text
