from datetime import date

from audiencebridge.readout import recommend, render_readout


def row(**kw):
    base = {
        "segment_name": "cart_abandoners_7d",
        "objective": "re-engage",
        "segment_size": 900,
        "matched_size": 300,
        "consented_size": 230,
        "activatable_size": 207,
        "meets_min": True,
        "purchase_rate": 0.041,
        "baseline_rate": 0.01,
        "lift_index": 4.1,
        "lift_p_value": 1e-9,
        "aa_p_value": 0.4,
        "aa_passes": True,
    }
    base.update(kw)
    return base


def test_recommendation_rules():
    assert recommend(row())[0] == "Activate"
    assert recommend(row(meets_min=False, activatable_size=40))[0] == "Hold"
    assert recommend(row(lift_index=1.2, lift_p_value=0.2))[0] == "Test"
    assert recommend(row(lift_index=0.8))[0] == "Do not prioritise"
    assert recommend(row(objective="exclude"))[0] == "Suppress"


def test_memo_uses_measured_numbers_only():
    memo = render_readout(
        [row(), row(segment_name="apparel_browsers", lift_index=1.1, lift_p_value=0.3, purchase_rate=0.011)],
        client_name="Demo Store",
        as_of="2020-12-31",
        future_end="2021-01-31",
        holdout_pct=10,
        model_metrics={"roc_auc": 0.8123},
        today=date(2021, 2, 1),
    )
    assert "4.10x" in memo and "4.1%" in memo and "1.0%" in memo
    assert "Recommended to activate first: cart_abandoners_7d" in memo
    assert "AUC 0.812" in memo
    assert "dry_run" in memo and "No data has been sent" in memo
    assert "A/A check passed" in memo


def test_memo_warns_when_aa_fails_and_handles_missing_values():
    memo = render_readout(
        [
            row(aa_passes=False),
            row(
                segment_name="empty",
                lift_index=None,
                purchase_rate=None,
                meets_min=None,
                activatable_size=0,
                lift_p_value=None,
                aa_passes=None,
            ),
        ],
        client_name="Demo",
        as_of="2020-12-31",
        future_end="2021-01-31",
        holdout_pct=10,
    )
    assert "Warning" in memo and "cart_abandoners_7d" in memo
    assert "n/a" in memo
