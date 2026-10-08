from __future__ import annotations

from dataclasses import dataclass

from . import bq
from .config import ClientConfig, Settings


@dataclass(frozen=True)
class Check:
    name: str
    sql: str


CHECKS = [
    Check("staging_not_empty", "SELECT IF(COUNT(*) = 0, 1, 0) AS violations FROM `{{ project }}.ab_staging.stg_ga4_events`"),
    Check(
        "user_features_user_not_null_and_unique",
        "SELECT COUNTIF(user_pseudo_id IS NULL) + (COUNT(*) - COUNT(DISTINCT user_pseudo_id)) AS violations "
        "FROM `{{ project }}.ab_marts.user_features`",
    ),
    Check(
        "no_future_leakage_in_features",
        "SELECT COUNTIF(last_seen > DATE '{{ as_of }}') AS violations FROM `{{ project }}.ab_marts.user_features`",
    ),
    Check(
        "segment_members_have_known_segments",
        "SELECT COUNT(*) AS violations FROM `{{ project }}.ab_marts.segment_members` m "
        "LEFT JOIN `{{ project }}.ab_marts.segments` s USING (segment_name) WHERE s.segment_name IS NULL",
    ),
    Check(
        "segment_members_unique",
        "SELECT COUNT(*) - COUNT(DISTINCT CONCAT(segment_name, ':', user_pseudo_id)) AS violations "
        "FROM `{{ project }}.ab_marts.segment_members`",
    ),
    Check(
        "activation_identifiers_are_sha256_hex",
        "SELECT COUNTIF("
        "(hashed_email IS NOT NULL AND NOT REGEXP_CONTAINS(hashed_email, r'^[0-9a-f]{64}$')) OR "
        "(hashed_phone IS NOT NULL AND NOT REGEXP_CONTAINS(hashed_phone, r'^[0-9a-f]{64}$')) OR "
        "(hashed_first_name IS NOT NULL AND NOT REGEXP_CONTAINS(hashed_first_name, r'^[0-9a-f]{64}$')) OR "
        "(hashed_last_name IS NOT NULL AND NOT REGEXP_CONTAINS(hashed_last_name, r'^[0-9a-f]{64}$'))"
        ") AS violations FROM `{{ project }}.ab_activation.activation_ready`",
    ),
    Check(
        "activation_has_no_raw_pii",
        "SELECT COUNTIF(REGEXP_CONTAINS(CONCAT(IFNULL(hashed_email, ''), IFNULL(hashed_phone, ''), "
        "IFNULL(region_code, ''), IFNULL(postal_code, '')), r'[@+]')) AS violations "
        "FROM `{{ project }}.ab_activation.activation_ready`",
    ),
    Check(
        "activation_excludes_non_consenting_users",
        "SELECT COUNT(*) AS violations FROM `{{ project }}.ab_activation.activation_ready` a "
        "JOIN (SELECT TO_HEX(SHA256(email_n)) AS h FROM `{{ project }}.ab_raw.crm_normalized` "
        "WHERE NOT consent_ok AND email_n IS NOT NULL) n ON a.hashed_email = n.h",
    ),
    Check(
        "activation_excludes_holdout_users",
        "SELECT COUNT(*) AS violations FROM `{{ project }}.ab_marts.holdout_assignments` h "
        "JOIN `{{ project }}.ab_marts.segments` s USING (segment_name) "
        "JOIN `{{ project }}.ab_raw.crm_normalized` c USING (user_pseudo_id) "
        "JOIN `{{ project }}.ab_activation.activation_ready` a "
        "ON a.segment_name = h.segment_name AND a.hashed_email = TO_HEX(SHA256(c.email_n)) "
        "WHERE h.is_holdout AND s.apply_holdout",
    ),
]


def run_checks(client, settings: Settings, cfg: ClientConfig) -> dict[str, int]:
    results = {}
    for check in CHECKS:
        sql = bq.render_sql(check.sql, bq.template_vars(settings, cfg))
        results[check.name] = int(bq.query_df(client, sql)["violations"].iloc[0])
    return results
