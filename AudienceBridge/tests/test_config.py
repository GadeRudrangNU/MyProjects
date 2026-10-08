from copy import deepcopy
from datetime import date

import pytest
import yaml

from audiencebridge.config import ROOT, ConfigError, load_client_config, parse_client_config, validate_rule

BASE = yaml.safe_load((ROOT / "config" / "clients" / "gmerch_store.yaml").read_text())


def cfg_with(**changes):
    data = deepcopy(BASE)
    data.update(changes)
    return parse_client_config(data)


def test_shipped_config_is_valid():
    cfg = load_client_config(ROOT / "config" / "clients" / "gmerch_store.yaml")
    assert cfg.as_of_date == date(2020, 12, 31)
    assert len(cfg.segments) == 6
    exclusion = next(s for s in cfg.segments if s.objective == "exclude")
    assert exclusion.holdout is False


def test_rule_returns_parameters():
    assert validate_rule("revenue_usd >= @p90_revenue_usd AND last_cart_date >= DATE_SUB(@as_of, INTERVAL 7 DAY)") == {
        "p90_revenue_usd",
        "as_of",
    }


@pytest.mark.parametrize(
    "rule",
    [
        "purchases > 0; DROP TABLE x",
        "purchases > 0 -- comment",
        "secret_column = 1",
        "email = 'a@b.com'",
        "(SELECT 1) = 1",
        "purchases > @p90_email",
        "purchases > @unknown",
        "purchases > `x`",
    ],
)
def test_unsafe_or_unknown_rules_are_rejected(rule):
    with pytest.raises(ConfigError):
        validate_rule(rule)


def test_string_literals_are_allowed_in_rules():
    assert validate_rule("device_category = 'mobile' AND purchases = 0") == set()


def test_missing_field_is_rejected():
    data = deepcopy(BASE)
    del data["segments"][0]["rule"]
    with pytest.raises(ConfigError, match="rule"):
        parse_client_config(data)


def test_unknown_objective_is_rejected():
    data = deepcopy(BASE)
    data["segments"][0]["objective"] = "world_domination"
    with pytest.raises(ConfigError, match="objective"):
        parse_client_config(data)


def test_duplicate_segment_names_are_rejected():
    data = deepcopy(BASE)
    data["segments"].append(deepcopy(data["segments"][0]))
    with pytest.raises(ConfigError, match="unique"):
        parse_client_config(data)


def test_bad_segment_name_is_rejected():
    data = deepcopy(BASE)
    data["segments"][0]["name"] = "x'; DROP"
    with pytest.raises(ConfigError, match="name"):
        parse_client_config(data)


def test_date_ordering_is_enforced():
    with pytest.raises(ConfigError, match="dates"):
        cfg_with(as_of_date="2021-02-15")


def test_propensity_rule_requires_propensity_enabled():
    with pytest.raises(ConfigError, match="propensity"):
        cfg_with(propensity={"enabled": False})
