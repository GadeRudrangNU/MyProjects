from __future__ import annotations

import hashlib
import re

import pandas as pd

from . import bq
from .config import ClientConfig, Settings

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_GMAIL_RE = re.compile(r"@(gmail|googlemail)\.com$")


def normalize_email(email: str | None) -> str | None:
    if not isinstance(email, str):
        return None
    value = email.strip().lower()
    if not _EMAIL_RE.match(value):
        return None
    if _GMAIL_RE.search(value):
        local, domain = value.split("@")
        return f"{local.replace('.', '')}@{domain}"
    return value


def normalize_phone(phone: str | None) -> str | None:
    if not isinstance(phone, str):
        return None
    digits = re.sub(r"[^0-9]", "", phone)
    if phone.strip().startswith("+") and 8 <= len(digits) <= 15:
        return "+" + digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def normalize_name(name: str | None) -> str | None:
    if not isinstance(name, str):
        return None
    value = name.strip().lower()
    return value or None


def sha256_hex(value: str | None) -> str | None:
    if value is None:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_email(email: str | None) -> str | None:
    return sha256_hex(normalize_email(email))


def hash_phone(phone: str | None) -> str | None:
    return sha256_hex(normalize_phone(phone))


_E = "LOWER(TRIM(email))"
EMAIL_SQL = (
    f"CASE WHEN REGEXP_CONTAINS({_E}, r'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$') THEN "
    f"CASE WHEN REGEXP_CONTAINS({_E}, r'@(gmail|googlemail)\\.com$') "
    f"THEN CONCAT(REPLACE(SPLIT({_E}, '@')[OFFSET(0)], '.', ''), '@', SPLIT({_E}, '@')[OFFSET(1)]) "
    f"ELSE {_E} END END"
)

_D = "REGEXP_REPLACE(phone, r'[^0-9]', '')"
PHONE_SQL = (
    f"CASE "
    f"WHEN STARTS_WITH(TRIM(phone), '+') AND LENGTH({_D}) BETWEEN 8 AND 15 THEN CONCAT('+', {_D}) "
    f"WHEN LENGTH({_D}) = 10 THEN CONCAT('+1', {_D}) "
    f"WHEN LENGTH({_D}) = 11 AND STARTS_WITH({_D}, '1') THEN CONCAT('+', {_D}) "
    f"END"
)


def name_sql(column: str) -> str:
    return f"NULLIF(LOWER(TRIM({column})), '')"


def sql_expressions() -> dict[str, str]:
    return {
        "email_expr": EMAIL_SQL,
        "phone_expr": PHONE_SQL,
        "name_expr_first": name_sql("first_name"),
        "name_expr_last": name_sql("last_name"),
    }


def build_activation_tables(client, settings: Settings, cfg: ClientConfig) -> pd.DataFrame:
    exprs = sql_expressions()
    bq.run_sql_file(client, settings, cfg, "activation/crm_normalized.sql", **exprs)
    bq.run_sql_file(client, settings, cfg, "activation/activation_ready.sql")

    funnel = bq.query_file_df(client, settings, cfg, "activation/audience_funnel.sql")
    funnel = pd.DataFrame({"segment_name": [s.name for s in cfg.segments]}).merge(funnel, on="segment_name", how="left")
    count_cols = [c for c in funnel.columns if c != "segment_name"]
    funnel[count_cols] = funnel[count_cols].fillna(0).astype("int64")
    funnel["excluded_no_crm_match"] = funnel["segment_size"] - funnel["matched_size"]
    funnel["excluded_no_consent"] = funnel["matched_size"] - funnel["consented_size"]
    funnel["excluded_no_valid_id"] = funnel["consented_size"] - funnel["valid_id_size"]
    funnel["meets_min"] = funnel["activatable_size"] >= cfg.min_audience_size
    bq.load_df(client, funnel, bq.table_id(settings, "activation", "audience_summary"))
    return funnel
