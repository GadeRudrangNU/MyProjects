from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from . import bq
from .config import ClientConfig, SegmentSpec, Settings, parse_percentile_param, validate_rule


def used_params(specs: tuple[SegmentSpec, ...] | list[SegmentSpec]) -> set[str]:
    params: set[str] = set()
    for spec in specs:
        params |= validate_rule(spec.rule)
    return params


def percentile_params(specs) -> dict[str, tuple[int, str]]:
    result = {}
    for name in sorted(used_params(specs)):
        parsed = parse_percentile_param(name)
        if parsed:
            result[name] = parsed
    return result


def percentile_sql(base_table: str, pct: int, column: str) -> str:
    return f"SELECT APPROX_QUANTILES(IF({column} > 0, {column}, NULL), 100)[OFFSET({pct})] AS value FROM `{base_table}`"


def build_membership_sql(base_table: str, specs) -> str:
    parts = [
        f"SELECT '{spec.name}' AS segment_name, user_pseudo_id, @as_of AS as_of_date FROM `{base_table}` WHERE ({spec.rule})"
        for spec in specs
    ]
    return "\nUNION ALL\n".join(parts)


def build_segment_base(client, settings: Settings, cfg: ClientConfig) -> None:
    scores = bq.table_id(settings, "marts", "propensity_scores")
    have_scores = cfg.propensity_enabled and bq.table_exists(client, scores)
    if have_scores:
        select = ", p.propensity_score"
        join = f"LEFT JOIN `{scores}` AS p ON p.user_pseudo_id = f.user_pseudo_id"
    else:
        select = ", CAST(NULL AS FLOAT64) AS propensity_score"
        join = ""
    bq.run_sql_file(client, settings, cfg, "marts/segment_base.sql", propensity_select=select, propensity_join=join)


def build(client, settings: Settings, cfg: ClientConfig) -> pd.DataFrame:
    from google.cloud import bigquery

    build_segment_base(client, settings, cfg)
    base = bq.table_id(settings, "marts", "segment_base")

    query_params = [bigquery.ScalarQueryParameter("as_of", "DATE", cfg.as_of_date)]
    resolved = []
    for name, (pct, column) in percentile_params(cfg.segments).items():
        value = bq.query_df(client, percentile_sql(base, pct, column))["value"].iloc[0]
        if pd.isna(value):
            raise RuntimeError(f"@{name} could not be computed: no rows with {column} > 0")
        query_params.append(bigquery.ScalarQueryParameter(name, "FLOAT64", float(value)))
        resolved.append({"param": name, "value": float(value)})

    members_table = bq.table_id(settings, "marts", "segment_members")
    job_config = bigquery.QueryJobConfig(
        query_parameters=query_params,
        destination=members_table,
        write_disposition="WRITE_TRUNCATE",
    )
    client.query(build_membership_sql(base, cfg.segments), job_config=job_config).result()

    stats = bq.query_df(
        client,
        f"SELECT m.segment_name, COUNT(*) AS size, SUM(b.revenue_usd) AS total_revenue "
        f"FROM `{members_table}` AS m JOIN `{base}` AS b USING (user_pseudo_id) GROUP BY m.segment_name",
    )
    total_revenue = float(bq.query_df(client, f"SELECT SUM(revenue_usd) AS r FROM `{base}`")["r"].iloc[0] or 0.0)
    summary = summarize(cfg.segments, stats, total_revenue)
    bq.load_df(client, summary, bq.table_id(settings, "marts", "segments"))
    if resolved:
        bq.load_df(client, pd.DataFrame(resolved), bq.table_id(settings, "marts", "segment_params"))
    return summary


def summarize(specs, stats: pd.DataFrame, total_revenue: float) -> pd.DataFrame:
    meta = pd.DataFrame(
        [
            {
                "segment_name": s.name,
                "objective": s.objective,
                "membership_days": s.membership_days,
                "apply_holdout": s.holdout,
                "eval_only": s.eval_only,
            }
            for s in specs
        ]
    )
    merged = meta.merge(stats, on="segment_name", how="left")
    merged["size"] = merged["size"].fillna(0).astype("int64")
    merged["total_revenue"] = merged["total_revenue"].fillna(0.0).astype("float64")
    merged["revenue_share"] = merged["total_revenue"] / total_revenue if total_revenue else 0.0
    merged["built_at"] = datetime.now(timezone.utc)
    return merged
