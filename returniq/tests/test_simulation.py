import numpy as np
import pytest

from backend.app import experiment
from backend.app.simulation import Assumptions, select_top_fraction, simulate

RISK = np.array([0.5, 0.2, 0.1, 0.05])
VALUE = np.array([100.0, 50.0, 200.0, 10.0])
INV = np.array([1, 1, 2, 3])
CUST = np.array([9, 9, 8, 7])


def test_select_top_fraction_picks_highest_scores():
    m = select_top_fraction(np.array([0.1, 0.9, 0.5, 0.3]), 0.5)
    assert list(m) == [False, True, True, False]
    assert select_top_fraction(np.array([0.1, 0.2]), 0).sum() == 0


def test_simulate_exact_arithmetic():
    a = Assumptions(effectiveness=0.5, cost_per_order=2.0, margin=0.4, conversion_loss=0.1, handling_cost_per_credit=1.0, credit_fraction=1.0)
    t = np.array([True, True, False, False])
    r = simulate(RISK, VALUE, INV, CUST, t, a)
    assert (r["targeted_lines"], r["targeted_orders"], r["targeted_customers"]) == (2, 1, 1)
    assert r["expected_credits_in_targeted"] == pytest.approx(0.7)
    expected_value = 0.5 * 100 + 0.2 * 50
    assert r["expected_credit_value_in_targeted"] == pytest.approx(expected_value)
    assert r["returns_prevented"] == pytest.approx(0.35)
    assert r["revenue_preserved"] == pytest.approx(30.0)
    assert r["margin_preserved"] == pytest.approx(12.0)
    assert r["handling_cost_saved"] == pytest.approx(0.35)
    assert r["intervention_cost"] == pytest.approx(2.0)
    kept = 0.5 * 100 + 0.8 * 50
    assert r["conversion_margin_lost"] == pytest.approx(kept * 0.1 * 0.4)
    assert r["net_benefit"] == pytest.approx(12.0 + 0.35 - 2.0 - 3.6)


def test_zero_effectiveness_never_creates_benefit():
    a = Assumptions(0.0, 1.0, 0.3, 0.0)
    r = simulate(RISK, VALUE, INV, CUST, np.ones(4, bool), a)
    assert r["returns_prevented"] == 0 and r["net_benefit"] == pytest.approx(-r["intervention_cost"])


def test_breakeven_effectiveness_gives_zero_net():
    a = Assumptions(0.3, 1.0, 0.4, 0.05, 0.5)
    t = np.ones(4, bool)
    be = simulate(RISK, VALUE, INV, CUST, t, a)["breakeven_effectiveness"]
    r = simulate(RISK, VALUE, INV, CUST, t, Assumptions(be, 1.0, 0.4, 0.05, 0.5))
    assert r["net_benefit"] == pytest.approx(0.0, abs=1e-9)


def test_backtest_block_reports_observed_values():
    out = np.array([1.0, 0.0, 0.0, 1.0])
    cv = np.array([80.0, 0, 0, 5.0])
    r = simulate(RISK, VALUE, INV, CUST, np.array([True, True, False, False]), Assumptions(0.1, 0, 0.3, 0), observed_credited_value=cv, observed_outcome=out)
    assert r["backtest"]["observed_credited_lines_in_targeted"] == 1
    assert r["backtest"]["observed_precision"] == 0.5
    assert r["backtest"]["share_of_all_observed_credited_value_captured"] == pytest.approx(80 / 85)


def test_sample_size_matches_closed_form():
    r = experiment.sample_size_per_arm(0.10, 0.20)
    za, zb = 1.959964, 0.841621
    p1, p2 = 0.10, 0.08
    n = (za * (2 * 0.09 * 0.91) ** 0.5 + zb * (p1 * 0.9 + p2 * 0.92) ** 0.5) ** 2 / 0.02 ** 2
    assert r["n_per_arm"] == int(np.ceil(n))
    assert 3000 < r["n_per_arm"] < 3600


def test_sample_size_grows_when_effect_shrinks_and_validates_input():
    assert experiment.sample_size_per_arm(0.05, 0.10)["n_per_arm"] > experiment.sample_size_per_arm(0.05, 0.30)["n_per_arm"]
    with pytest.raises(ValueError):
        experiment.sample_size_per_arm(1.2, 0.1)
    assert experiment.duration_weeks(1000, 500) == 4.0
