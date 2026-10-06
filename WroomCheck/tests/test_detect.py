from datetime import date, timedelta

import numpy as np

from wroomcheck.detect import DetectConfig, build_alerts, cluster_stream
from wroomcheck.models import Complaint

DIM = 8


def unit(i: int) -> np.ndarray:
    v = np.zeros(DIM, dtype=np.float32)
    v[i] = 1.0
    return v


def complaint(cid: int, day: date, severe: bool = False) -> Complaint:
    return Complaint(cid, "ACME", "ROADRUNNER", 2020, "FUEL SYSTEM:GASOLINE", "FUEL SYSTEM", day, None,
                     "text", fire=severe)


def run(events, cfg=None):
    """events: list of (day, axis, severe). Axis picks which unit vector the complaint points along."""
    cfg = cfg or DetectConfig(threshold=0.9)
    items = [(complaint(i, d, s), unit(ax)) for i, (d, ax, s) in enumerate(sorted(events))]
    return build_alerts(list(cluster_stream(items, cfg)), cfg)


def test_orthogonal_complaints_form_separate_clusters():
    cfg = DetectConfig(threshold=0.9, min_cluster_size=1)
    items = [(complaint(i, date(2020, 1, 1) + timedelta(days=i)), unit(i % 3)) for i in range(9)]
    clusters = list(cluster_stream(items, cfg))
    assert len(clusters) == 3 and all(len(c.members) == 3 for c in clusters)


def test_spike_raises_alert_on_the_day_threshold_is_reached():
    start = date(2020, 6, 1)
    alerts = run([(start + timedelta(days=i * 3), 0, False) for i in range(10)])
    assert len(alerts) == 1
    assert alerts[0].alert_date == start + timedelta(days=27)  # 10th complaint
    assert alerts[0].n_window == 10


def test_slow_trickle_never_alerts():
    start = date(2020, 1, 1)
    assert run([(start + timedelta(days=i * 20), 0, False) for i in range(40)]) == []


def test_chronic_cluster_does_not_alert_on_a_small_bump():
    start = date(2019, 1, 1)
    steady = [(start + timedelta(days=i * 12), 0, False) for i in range(60)]  # ~7.5 per 90d for 2 years
    bump = [(date(2021, 1, 1) + timedelta(days=i), 0, False) for i in range(2)]
    assert run(steady + bump) == []


def test_severe_reports_halve_the_count_needed():
    start = date(2020, 6, 1)
    events = [(start + timedelta(days=i), 0, i < 2) for i in range(5)]
    assert len(run(events)) == 1
    assert run([(d, a, False) for d, a, _ in events]) == []


def test_near_duplicate_clusters_are_merged_into_the_earliest_alert():
    start = date(2020, 6, 1)
    a = [(start + timedelta(days=i), 0, False) for i in range(10)]
    b = [(start + timedelta(days=30 + i), 1, False) for i in range(10)]  # a different text cluster
    alerts = run(a + b)
    assert len(alerts) == 1 and alerts[0].merged_count == 2
