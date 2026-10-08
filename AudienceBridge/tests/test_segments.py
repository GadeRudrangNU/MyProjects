import pandas as pd

from audiencebridge import segments
from audiencebridge.config import ROOT, load_client_config

CFG = load_client_config(ROOT / "config" / "clients" / "gmerch_store.yaml")


def test_percentile_params_found():
    params = segments.percentile_params(CFG.segments)
    assert params == {"p90_revenue_usd": (90, "revenue_usd"), "p90_propensity_score": (90, "propensity_score")}


def test_membership_sql_has_one_branch_per_segment():
    sql = segments.build_membership_sql("proj.ab_marts.segment_base", CFG.segments)
    assert sql.count("UNION ALL") == len(CFG.segments) - 1
    for spec in CFG.segments:
        assert f"'{spec.name}' AS segment_name" in sql
    assert "@as_of" in sql and "@p90_revenue_usd" in sql


def test_percentile_sql_ignores_non_positive_values():
    sql = segments.percentile_sql("t", 90, "revenue_usd")
    assert "IF(revenue_usd > 0, revenue_usd, NULL)" in sql and "OFFSET(90)" in sql


def test_summary_keeps_empty_segments_and_computes_share():
    stats = pd.DataFrame([{"segment_name": "high_value_buyers", "size": 10, "total_revenue": 500.0}])
    summary = segments.summarize(CFG.segments, stats, total_revenue=1000.0)
    assert len(summary) == len(CFG.segments)
    row = summary.set_index("segment_name").loc["high_value_buyers"]
    assert row["size"] == 10 and row["revenue_share"] == 0.5
    assert summary.set_index("segment_name").loc["cart_abandoners_7d", "size"] == 0
    assert summary.set_index("segment_name").loc["recent_purchasers_exclusion", "apply_holdout"] == False  # noqa: E712
