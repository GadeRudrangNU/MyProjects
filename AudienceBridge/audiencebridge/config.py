from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent

DATASETS = {
    "raw": "ab_raw",
    "staging": "ab_staging",
    "marts": "ab_marts",
    "activation": "ab_activation",
    "measurement": "ab_measurement",
}

KNOWN_OBJECTIVES = frozenset({"re-engage", "premium_offers", "win_back", "category_prospecting", "likely_to_buy", "exclude"})

RULE_COLUMNS = frozenset(
    {
        "first_seen",
        "last_seen",
        "sessions",
        "item_views",
        "add_to_carts",
        "purchases",
        "revenue_usd",
        "last_cart_date",
        "last_purchase_date",
        "apparel_views",
        "days_since_last_seen",
        "device_category",
        "country",
        "propensity_score",
    }
)
NUMERIC_RULE_COLUMNS = frozenset(
    {
        "sessions",
        "item_views",
        "add_to_carts",
        "purchases",
        "revenue_usd",
        "apparel_views",
        "days_since_last_seen",
        "propensity_score",
    }
)
RULE_KEYWORDS = frozenset(
    {
        "AND",
        "OR",
        "NOT",
        "IS",
        "NULL",
        "IN",
        "BETWEEN",
        "TRUE",
        "FALSE",
        "DATE_SUB",
        "DATE_ADD",
        "DATE_DIFF",
        "INTERVAL",
        "DAY",
        "WEEK",
        "MONTH",
        "COALESCE",
        "IFNULL",
        "LOWER",
        "UPPER",
        "LIKE",
    }
)

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
_PARAM_RE = re.compile(r"@([A-Za-z_]\w*)")
_PCT_PARAM_RE = re.compile(r"^p(\d{1,2})_([a-z_]+)$")
_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_FORBIDDEN_RULE = re.compile(r";|--|/\*|\*/|`|\\|#")


class ConfigError(ValueError):
    pass


def load_dotenv(path: Path | None = None) -> None:
    path = path or ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Settings:
    project: str
    location: str = "US"
    client_config: Path = ROOT / "config" / "clients" / "gmerch_store.yaml"

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        project = os.environ.get("GCP_PROJECT", "").strip()
        if not project:
            raise ConfigError("GCP_PROJECT is not set (put it in .env or the environment).")
        return cls(
            project=project,
            location=os.environ.get("BQ_LOCATION", "US"),
            client_config=Path(os.environ.get("CLIENT_CONFIG", cls.client_config)),
        )


@dataclass(frozen=True)
class SegmentSpec:
    name: str
    objective: str
    rule: str
    membership_days: int
    holdout: bool = True
    eval_only: bool = False


@dataclass(frozen=True)
class ClientConfig:
    client: str
    display_name: str
    start_date: date
    end_date: date
    as_of_date: date
    future_end_date: date
    min_audience_size: int
    holdout_pct: int
    holdout_salt: str
    alpha: float
    propensity_enabled: bool
    propensity_backend: str
    eval_pct: int
    crm: dict[str, Any]
    activation: dict[str, Any]
    segments: tuple[SegmentSpec, ...]

    @property
    def uses_propensity(self) -> bool:
        return any("propensity_score" in s.rule for s in self.segments)


def _to_date(value: Any, field: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError as exc:
        raise ConfigError(f"{field}: expected YYYY-MM-DD, got {value!r}") from exc


def _strip_literals(rule: str) -> str:
    return re.sub(r"'[^']*'", "''", rule)


def validate_rule(rule: str) -> set[str]:
    if not isinstance(rule, str) or not rule.strip():
        raise ConfigError("rule must be a non-empty string")
    if _FORBIDDEN_RULE.search(_strip_literals(rule)):
        raise ConfigError(f"rule contains a forbidden character sequence: {rule!r}")
    stripped = _strip_literals(rule)
    params = set(_PARAM_RE.findall(stripped))
    for param in params:
        if param == "as_of":
            continue
        match = _PCT_PARAM_RE.match(param)
        if not match or match.group(2) not in NUMERIC_RULE_COLUMNS or not 1 <= int(match.group(1)) <= 99:
            raise ConfigError(f"unknown parameter @{param} (use @as_of or @pNN_<numeric column>)")
    body = _PARAM_RE.sub(" ", stripped)
    for token in _IDENT_RE.findall(body):
        if token in RULE_COLUMNS or token.upper() in RULE_KEYWORDS:
            continue
        raise ConfigError(f"rule references unknown identifier {token!r}")
    return params


def parse_percentile_param(name: str) -> tuple[int, str] | None:
    match = _PCT_PARAM_RE.match(name)
    return (int(match.group(1)), match.group(2)) if match else None


def _parse_segment(raw: dict[str, Any]) -> SegmentSpec:
    for key in ("name", "objective", "rule", "membership_days"):
        if key not in raw:
            raise ConfigError(f"segment is missing required field {key!r}: {raw}")
    name = raw["name"]
    if not isinstance(name, str) or not _NAME_RE.match(name):
        raise ConfigError(f"segment name {name!r} must match {_NAME_RE.pattern}")
    if raw["objective"] not in KNOWN_OBJECTIVES:
        raise ConfigError(f"segment {name}: unknown objective {raw['objective']!r}")
    days = raw["membership_days"]
    if not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= 540:
        raise ConfigError(f"segment {name}: membership_days must be an integer in 1..540")
    rule = " ".join(str(raw["rule"]).split())
    try:
        validate_rule(rule)
    except ConfigError as exc:
        raise ConfigError(f"segment {name}: {exc}") from exc
    holdout = raw.get("holdout", raw["objective"] != "exclude")
    return SegmentSpec(
        name=name,
        objective=raw["objective"],
        rule=rule,
        membership_days=days,
        holdout=bool(holdout),
        eval_only=bool(raw.get("eval_only", False)),
    )


def parse_client_config(data: dict[str, Any]) -> ClientConfig:
    for key in ("client", "as_of_date", "future_end_date", "min_audience_size", "segments"):
        if key not in data:
            raise ConfigError(f"client config is missing {key!r}")
    window = data.get("data", {})
    measurement = data.get("measurement", {})
    propensity = data.get("propensity", {})
    as_of = _to_date(data["as_of_date"], "as_of_date")
    future_end = _to_date(data["future_end_date"], "future_end_date")
    start = _to_date(window.get("start_date", "2020-11-01"), "data.start_date")
    end = _to_date(window.get("end_date", data["future_end_date"]), "data.end_date")
    if not start <= as_of < future_end <= end:
        raise ConfigError("dates must satisfy data.start <= as_of < future_end <= data.end")

    min_size = data["min_audience_size"]
    if not isinstance(min_size, int) or min_size < 1:
        raise ConfigError("min_audience_size must be a positive integer")
    holdout_pct = measurement.get("holdout_pct", 10)
    if not isinstance(holdout_pct, int) or not 1 <= holdout_pct <= 50:
        raise ConfigError("measurement.holdout_pct must be an integer in 1..50")
    backend = propensity.get("backend", "bqml")
    if backend not in ("bqml", "sklearn"):
        raise ConfigError("propensity.backend must be 'bqml' or 'sklearn'")
    eval_pct = propensity.get("eval_pct", 20)
    if not isinstance(eval_pct, int) or not 5 <= eval_pct <= 50:
        raise ConfigError("propensity.eval_pct must be an integer in 5..50")

    raw_segments = data["segments"]
    if not isinstance(raw_segments, list) or not raw_segments:
        raise ConfigError("segments must be a non-empty list")
    segments = tuple(_parse_segment(s) for s in raw_segments)
    names = [s.name for s in segments]
    if len(set(names)) != len(names):
        raise ConfigError("segment names must be unique")

    cfg = ClientConfig(
        client=str(data["client"]),
        display_name=str(data.get("display_name", data["client"])),
        start_date=start,
        end_date=end,
        as_of_date=as_of,
        future_end_date=future_end,
        min_audience_size=min_size,
        holdout_pct=holdout_pct,
        holdout_salt=str(measurement.get("holdout_salt", "salt-v1")),
        alpha=float(measurement.get("alpha", 0.05)),
        propensity_enabled=bool(propensity.get("enabled", True)),
        propensity_backend=backend,
        eval_pct=eval_pct,
        crm=dict(data.get("crm", {})),
        activation=dict(data.get("activation", {})),
        segments=segments,
    )
    if cfg.uses_propensity and not cfg.propensity_enabled:
        raise ConfigError("a segment uses propensity_score but propensity.enabled is false")
    return cfg


def load_client_config(path: Path) -> ClientConfig:
    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ConfigError(f"{path}: expected a mapping at the top level")
    return parse_client_config(data)
