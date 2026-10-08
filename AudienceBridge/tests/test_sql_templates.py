import re

import pytest

from audiencebridge import bq, privacy
from audiencebridge.config import ROOT, Settings, load_client_config
from audiencebridge.quality import CHECKS

CFG = load_client_config(ROOT / "config" / "clients" / "gmerch_store.yaml")
SETTINGS = Settings(project="demo-project")
EXTRA = {
    **privacy.sql_expressions(),
    "propensity_select": ", CAST(NULL AS FLOAT64) AS propensity_score",
    "propensity_join": "",
}
SQL_FILES = sorted((ROOT / "sql").rglob("*.sql"))


@pytest.mark.parametrize("path", SQL_FILES, ids=lambda p: p.relative_to(ROOT / "sql").as_posix())
def test_every_template_renders_without_leftover_tokens(path):
    rendered = bq.render_sql(path.read_text(), bq.template_vars(SETTINGS, CFG, **EXTRA))
    assert "{{" not in rendered and "}}" not in rendered


def test_missing_variable_raises():
    with pytest.raises(KeyError):
        bq.render_sql("SELECT {{ nope }}", {})


def test_quality_checks_render():
    for check in CHECKS:
        rendered = bq.render_sql(check.sql, bq.template_vars(SETTINGS, CFG))
        assert "violations" in rendered and "{{" not in rendered


def test_future_data_never_enters_features():
    sql = (ROOT / "sql" / "marts" / "user_features.sql").read_text()
    assert "event_date <= DATE '{{ as_of }}'" in sql


def test_no_template_spells_out_raw_identifiers_in_activation_output():
    sql = (ROOT / "sql" / "activation" / "activation_ready.sql").read_text()
    select_list = sql.split("FROM")[0]
    assert not re.search(r"\bemail\b|\bphone\b", select_list.replace("hashed_email", "").replace("hashed_phone", ""))
    assert "user_pseudo_id" not in select_list
