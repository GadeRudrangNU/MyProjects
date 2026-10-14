import random

import pytest

from evaluator import metrics as m
from evaluator.campaign import draw_severity, plan_run


def result(device, kind, verdict, start=100.0, end=110.0, run_id=1):
    return {"run_id": run_id, "device_id": device, "kind": kind, "verdict": verdict, "started_at": start, "ended_at": end}


def fault(fid, device, ftype, start=90.0, end=200.0, severity=1.0):
    return {"id": fid, "device_id": device, "type": ftype, "severity": severity, "start_at": start, "end_at": end}


def test_percentile_nearest_rank():
    assert m.percentile(list(range(1, 21)), 95) == 19
    assert m.percentile([], 50) is None


def test_confusion_and_rates():
    rows = [
        {"actual": True, "predicted": True},
        {"actual": True, "predicted": True},
        {"actual": True, "predicted": False},
        {"actual": False, "predicted": True},
        {"actual": False, "predicted": False},
        {"actual": False, "predicted": False},
    ]
    c = m.confusion(rows)
    assert (c["tp"], c["fn"], c["fp"], c["tn"]) == (2, 1, 1, 2)
    assert c["recall"] == pytest.approx(2 / 3)
    assert c["precision"] == pytest.approx(2 / 3)
    assert c["false_alarm_rate"] == pytest.approx(1 / 3)
    assert c["f1"] == pytest.approx(2 / 3)


def test_error_results_are_excluded_from_scoring():
    rows = m.label_rows([result(1, "range_check", "ERROR"), result(1, "range_check", "FAIL")], [])
    assert len(rows) == 1 and rows[0]["predicted"]


def test_fault_must_overlap_the_test_window_and_match_its_catch_list():
    faults = [fault(1, 1, "stuck_value")]
    rows = m.label_rows(
        [
            result(1, "stability_check", "FAIL"),
            result(1, "range_check", "PASS"),
            result(2, "stability_check", "PASS"),
            result(1, "stability_check", "PASS", start=300, end=310),
        ],
        faults,
    )
    actual = [r["actual"] for r in rows]
    assert actual == [True, False, False, False]


def test_hang_is_expected_to_fail_every_test():
    rows = m.label_rows([result(1, k, "FAIL") for k in m.ALL_KINDS], [fault(1, 1, "hang")])
    assert all(r["actual"] for r in rows)


def test_time_to_detect_uses_matching_rules_only():
    faults = [fault(1, 1, "drift", start=100), fault(2, 2, "latency_spike"), fault(3, 3, "hang", start=100)]
    alerts = [
        {"device_id": 1, "rule": "stuck_value", "ts": 101.0},
        {"device_id": 1, "rule": "cusum_drift", "ts": 103.5},
        {"device_id": 1, "rule": "cusum_drift", "ts": 109.0},
        {"device_id": 3, "rule": "stale_signal", "ts": 101.2},
    ]
    ttd = m.time_to_detect(faults, alerts)
    assert ttd[1] == pytest.approx(3.5)
    assert 2 not in ttd
    assert ttd[3] == pytest.approx(1.2)


def test_missing_monitor_alert_is_reported_as_undetected():
    assert m.time_to_detect([fault(1, 1, "drift")], [])[1] is None


def test_severity_buckets_split_range_evenly():
    spec = {"drift": {"min": 0.0, "max": 1.0}}
    faults = [fault(i, 1, "drift", severity=s) for i, s in enumerate([0.05, 0.1, 0.9, 1.0])]
    detected = {0: False, 1: False, 2: True, 3: True}
    curve = m.detection_by_severity(faults, detected, {}, spec, buckets=2)["drift"]
    assert [b["n"] for b in curve] == [2, 2]
    assert [b["test_rate"] for b in curve] == [0.0, 1.0]


def test_histogram_counts_everything():
    hist = m.histogram([0.1, 0.2, 0.9, 1.0], 2)
    assert sum(b["count"] for b in hist) == 4


def test_campaign_plan_is_reproducible_and_leaves_devices_clean():
    catalog = {"faults": {"drift": {"min": 1, "max": 2, "applies": ["BMU"]}, "slow_response": {"min": 1, "max": 3, "applies": ["BCM"]}}}
    devices = [{"id": i, "type": "BMU" if i % 2 else "BCM"} for i in range(1, 21)]
    a = plan_run(random.Random(5), devices, catalog, 0.3)
    b = plan_run(random.Random(5), devices, catalog, 0.3)
    assert a == b
    assert len(a) == 14
    assert all(f["type"] == ("drift" if f["device_id"] % 2 else "slow_response") or f["device_id"] % 2 == 0 for f in a)


def test_severity_floor_skips_subtle_end():
    rng = random.Random(1)
    values = [draw_severity(rng, {"min": 0, "max": 10}, floor=0.5) for _ in range(200)]
    assert min(values) >= 5


def test_frozen_signal_is_expected_to_fail_the_response_test():
    rows = m.label_rows([result(1, "response_time", "FAIL"), result(1, "range_check", "PASS")], [fault(1, 1, "stuck_value")])
    assert [r["actual"] for r in rows] == [True, False]
