import pandas as pd
import pytest

from audiencebridge import measurement
from audiencebridge.config import SegmentSpec


def spec(name, eval_only=False):
    return SegmentSpec(name=name, objective="re-engage", rule="purchases = 0", membership_days=30, eval_only=eval_only)


def test_ztest_known_value():
    z, p = measurement.two_proportion_ztest(100, 1000, 150, 1000)
    assert z == pytest.approx(-3.381, abs=0.01)
    assert p == pytest.approx(0.00072, abs=0.0002)


def test_ztest_equal_rates_and_degenerate_cases():
    assert measurement.two_proportion_ztest(50, 500, 50, 500) == (0.0, 1.0)
    assert measurement.two_proportion_ztest(0, 0, 5, 10) == (0.0, 1.0)
    assert measurement.two_proportion_ztest(0, 100, 0, 100) == (0.0, 1.0)


def test_backtest_lift_against_baseline():
    seg = pd.DataFrame([{"segment_name": "a", "is_eval": False, "n": 1000, "k": 100, "revenue": 5000.0}])
    base = pd.DataFrame([{"is_eval": False, "n": 10000, "k": 200, "revenue": 9000.0}])
    out = measurement.compute_backtest([spec("a")], seg, base).iloc[0]
    assert out["purchase_rate"] == pytest.approx(0.10)
    assert out["baseline_rate"] == pytest.approx(0.02)
    assert out["lift_index"] == pytest.approx(5.0)
    assert out["revenue_per_user"] == pytest.approx(5.0)
    assert out["p_value"] < 0.001


def test_eval_only_segments_use_only_held_out_users():
    seg = pd.DataFrame(
        [
            {"segment_name": "p", "is_eval": False, "n": 900, "k": 800, "revenue": 0.0},
            {"segment_name": "p", "is_eval": True, "n": 100, "k": 10, "revenue": 0.0},
        ]
    )
    base = pd.DataFrame(
        [
            {"is_eval": False, "n": 8000, "k": 900, "revenue": 0.0},
            {"is_eval": True, "n": 2000, "k": 40, "revenue": 0.0},
        ]
    )
    out = measurement.compute_backtest([spec("p", eval_only=True)], seg, base).iloc[0]
    assert out["users"] == 100 and out["purchasers"] == 10
    assert out["baseline_rate"] == pytest.approx(0.02)
    assert out["lift_index"] == pytest.approx(5.0)


def test_empty_segment_does_not_crash():
    seg = pd.DataFrame(columns=["segment_name", "is_eval", "n", "k", "revenue"])
    base = pd.DataFrame([{"is_eval": False, "n": 100, "k": 5, "revenue": 10.0}])
    out = measurement.compute_backtest([spec("a")], seg, base).iloc[0]
    assert out["users"] == 0 and out["purchase_rate"] == 0.0


def test_aa_passes_when_arms_match_and_fails_when_they_differ():
    even = pd.DataFrame(
        [
            {"segment_name": "a", "is_holdout": False, "n": 9000, "k": 450},
            {"segment_name": "a", "is_holdout": True, "n": 1000, "k": 50},
        ]
    )
    assert measurement.compute_aa([spec("a")], even, 0.05).iloc[0]["passes"] == True  # noqa: E712

    skewed = pd.DataFrame(
        [
            {"segment_name": "a", "is_holdout": False, "n": 9000, "k": 900},
            {"segment_name": "a", "is_holdout": True, "n": 1000, "k": 20},
        ]
    )
    assert measurement.compute_aa([spec("a")], skewed, 0.05).iloc[0]["passes"] == False  # noqa: E712


def test_aa_alpha_is_bonferroni_adjusted():
    frame = pd.DataFrame(columns=["segment_name", "is_holdout", "n", "k"])
    out = measurement.compute_aa([spec("a"), spec("b"), spec("c"), spec("d")], frame, 0.05)
    assert out["alpha_adjusted"].iloc[0] == pytest.approx(0.0125)
    assert out["passes"].isna().all()
