import numpy as np
import pandas as pd
import pytest

from ml import config, severity, sentiment
from ml.priority import SEVERITY_OVERRIDE_SCORE, ThemeSignals, normalize_weights, score_themes, trend_component
from ml.trends import choose_window, detect_emerging


def sig(i, mentions, neg, sev=0.4, sent=-0.3, trend=0.0, fit=5.0, override=None):
    return ThemeSignals(i, mentions, neg, sev, sent, trend, fit, override)


# ---------------- priority ----------------
def test_weights_normalize_and_zero_weights_fall_back_to_uniform():
    w = normalize_weights({"frequency": 3, "severity": 1})
    assert pytest.approx(sum(w.values())) == 1 and w["frequency"] == 0.75
    assert pytest.approx(sum(normalize_weights({}).values())) == 1


def test_contributions_sum_to_priority_and_stay_in_range():
    rows = score_themes([sig(1, 1000, 600, sev=0.8, trend=1.5), sig(2, 50, 10, sev=0.1, trend=-0.4)], config.DEFAULT_WEIGHTS)
    for r in rows:
        assert pytest.approx(sum(r["contributions"].values()), abs=0.05) == r["priority"]
        assert 0 <= r["priority"] <= 100
    assert [r["rank"] for r in rows] == [1, 2] and rows[0]["theme_id"] == 1


def test_changing_weights_reorders_backlog():
    big_but_mild = sig(1, 2000, 300, sev=0.1, trend=0.0)
    small_but_severe = sig(2, 100, 90, sev=0.95, trend=0.0)
    freq_heavy = {"frequency": 1, "severity": 0, "trend": 0, "customer_impact": 0, "sentiment": 0, "strategic_fit": 0}
    sev_heavy = {**freq_heavy, "frequency": 0, "severity": 1}
    assert score_themes([big_but_mild, small_but_severe], freq_heavy)[0]["theme_id"] == 1
    assert score_themes([big_but_mild, small_but_severe], sev_heavy)[0]["theme_id"] == 2


def test_pm_severity_override_changes_score():
    base = score_themes([sig(1, 100, 50, sev=0.1)], config.DEFAULT_WEIGHTS)[0]["components"]["severity"]
    over = score_themes([sig(1, 100, 50, sev=0.1, override="critical")], config.DEFAULT_WEIGHTS)[0]["components"]["severity"]
    assert base == pytest.approx(0.1) and over == SEVERITY_OVERRIDE_SCORE["critical"]


def test_strategic_fit_moves_score_only_through_its_weight():
    w0 = {**config.DEFAULT_WEIGHTS, "strategic_fit": 0}
    a = score_themes([sig(1, 100, 50, fit=0), sig(2, 100, 50, fit=10)], w0)
    assert a[0]["priority"] == a[1]["priority"]
    b = score_themes([sig(1, 100, 50, fit=0), sig(2, 100, 50, fit=10)], config.DEFAULT_WEIGHTS)
    assert b[0]["theme_id"] == 2


def test_trend_component_is_clipped_and_monotonic():
    assert trend_component(-0.9) == 0 and trend_component(5) == 1
    assert trend_component(0.2) < trend_component(0.8)


# ---------------- severity / sentiment ----------------
def test_severity_is_explainable_and_positive_mentions_are_not_severe():
    s = sentiment.sentiment_score("App crashes on login and I was charged twice, terrible", 1)
    score, hits = severity.severity_score("App crashes on login and I was charged twice, terrible", s, 1)
    assert {"crash_or_failure", "security_payment_account"} <= set(hits) and score >= 0.5
    assert severity.level_for(score) in ("high", "critical")
    ok, none = severity.severity_score("Love it, never had a crash or error", 0.8, 5)
    assert ok == 0 and none == {}


def test_sentiment_blends_rating_only_when_known():
    text = "It is okay"
    assert sentiment.sentiment_score(text, None) == sentiment.vader_score(text)
    assert sentiment.sentiment_score(text, 1) < sentiment.sentiment_score(text, 5)
    assert sentiment.rating_signal(float("nan")) is None


# ---------------- trends ----------------
def _frame(daily: dict, days=200, start="2024-01-01"):
    rows = []
    for tid, fn in daily.items():
        for d in range(days):
            rows += [{"theme_id": tid, "created_at": pd.Timestamp(start) + pd.Timedelta(days=d)}] * fn(d)
    return pd.DataFrame(rows)


def test_spiking_theme_is_flagged_and_steady_theme_is_not():
    last = 199
    df = _frame({1: lambda d: 2, 2: lambda d: 20 if d > last - 7 else 2, 3: lambda d: 30})
    spec = choose_window(df.created_at, candidates=(7,), min_records=10)
    res = detect_emerging(df, spec=spec)
    t = res["themes"]
    assert t[2]["flagged"] and t[2]["z_score"] >= config.TREND_Z_FLAG
    assert t[2]["absolute_increase"] == pytest.approx(18 * 7, rel=0.01)
    assert not t[1]["flagged"] and not t[3]["flagged"]
    assert res["window"]["days"] == 7


def test_general_volume_growth_alone_does_not_flag_anything():
    # every theme doubles in the last window -> shares unchanged -> nothing is "emerging"
    last = 199
    df = _frame({1: lambda d: 10 * (2 if d > last - 7 else 1), 2: lambda d: 10 * (2 if d > last - 7 else 1)})
    res = detect_emerging(df, spec=choose_window(df.created_at, candidates=(7,), min_records=10))
    assert not any(t["flagged"] for t in res["themes"].values())
    assert res["themes"][1]["pct_increase"] == pytest.approx(1.0, abs=0.05)   # raw counts doubled
    assert abs(res["themes"][1]["share_change"]) < 0.1                        # but share is flat


def test_window_choice_adapts_to_dataset_size():
    dates = pd.Series(pd.date_range("2010-01-01", periods=400)).repeat(50)    # 50/day, ancient dates
    spec = choose_window(dates, candidates=(7, 14, 30), min_records=1000)
    assert spec.days == 30 and spec.recent_total == 1500                     # 7d=350 and 14d=700 are too thin
