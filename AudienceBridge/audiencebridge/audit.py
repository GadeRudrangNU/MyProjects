from __future__ import annotations

from datetime import date

from . import bq
from .config import ROOT, ClientConfig, Settings


def run(client, settings: Settings, cfg: ClientConfig) -> str:
    stg = bq.table_id(settings, "staging", "stg_ga4_events")
    overview = bq.query_df(
        client,
        f"SELECT COUNT(*) AS events, COUNT(DISTINCT user_pseudo_id) AS users, MIN(event_date) AS first_day, "
        f"MAX(event_date) AS last_day, COUNTIF(event_name = 'purchase') AS purchases, "
        f"SUM(IF(event_name = 'purchase', purchase_revenue_usd, 0)) AS revenue, "
        f"COUNTIF(country IS NULL OR country LIKE '<%') AS unknown_country_events, "
        f"COUNTIF(device_category IS NULL) AS null_device_events FROM `{stg}`",
    ).iloc[0]
    events = bq.query_df(
        client,
        f"SELECT event_name, COUNT(*) AS events FROM `{stg}` GROUP BY event_name ORDER BY events DESC LIMIT 15",
    )
    segments = bq.query_df(
        client,
        f"SELECT s.segment_name, s.objective, s.size, s.revenue_share, a.activatable_size "
        f"FROM `{bq.table_id(settings, 'marts', 'segments')}` s "
        f"LEFT JOIN `{bq.table_id(settings, 'activation', 'audience_summary')}` a USING (segment_name) "
        f"ORDER BY s.size DESC",
    )

    lines = [
        f"# Data audit: {cfg.display_name}",
        "",
        f"Generated {date.today().isoformat()}. Window {cfg.start_date} to {cfg.end_date}; as-of date {cfg.as_of_date}.",
        "",
        "## Source overview",
        "",
        f"- Events: {int(overview['events']):,} across {int(overview['users']):,} users",
        f"- Date range: {overview['first_day']} to {overview['last_day']}",
        f"- Purchase events: {int(overview['purchases']):,}, revenue ${float(overview['revenue']):,.2f}",
        f"- Events with unknown country (obfuscated or null): {int(overview['unknown_country_events']):,}",
        f"- Events with no device category: {int(overview['null_device_events']):,}",
        "",
        "## Top events",
        "",
        "| Event | Count |",
        "|---|---:|",
        *[f"| {r.event_name} | {int(r.events):,} |" for r in events.itertuples()],
        "",
        "## Opportunity sizing",
        "",
        "| Segment | Objective | Behavioural size | Share of revenue | Activatable |",
        "|---|---|---:|---:|---:|",
        *[
            f"| {r.segment_name} | {r.objective} | {int(r.size):,} | {float(r.revenue_share) * 100:.1f}% | "
            f"{'n/a' if r.activatable_size != r.activatable_size else f'{int(r.activatable_size):,}'} |"
            for r in segments.itertuples()
        ],
        "",
    ]
    text = "\n".join(lines)
    path = ROOT / "reports" / "data_audit.md"
    path.parent.mkdir(exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return str(path)
