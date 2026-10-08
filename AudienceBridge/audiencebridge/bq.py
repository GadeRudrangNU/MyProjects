from __future__ import annotations

import re
from typing import Any, Iterable

import pandas as pd

from .config import DATASETS, ROOT, ClientConfig, Settings

SQL_DIR = ROOT / "sql"
_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def render_sql(text: str, variables: dict[str, Any]) -> str:

    def sub(match: re.Match) -> str:
        name = match.group(1)
        if name not in variables:
            raise KeyError(f"SQL template variable {name!r} is not defined")
        return str(variables[name])

    return _TOKEN_RE.sub(sub, text)


def template_vars(settings: Settings, cfg: ClientConfig, **extra: Any) -> dict[str, Any]:
    base = {
        "project": settings.project,
        "as_of": cfg.as_of_date.isoformat(),
        "future_end": cfg.future_end_date.isoformat(),
        "start_suffix": cfg.start_date.strftime("%Y%m%d"),
        "end_suffix": cfg.end_date.strftime("%Y%m%d"),
        "holdout_pct": cfg.holdout_pct,
        "holdout_salt": re.sub(r"[^A-Za-z0-9_-]", "", cfg.holdout_salt),
        "eval_pct": cfg.eval_pct,
    }
    base.update(extra)
    return base


def get_client(settings: Settings):
    from google.cloud import bigquery

    return bigquery.Client(project=settings.project, location=settings.location)


def table_id(settings: Settings, dataset_key: str, table: str) -> str:
    return f"{settings.project}.{DATASETS[dataset_key]}.{table}"


def ensure_datasets(client, settings: Settings) -> None:
    from google.cloud import bigquery

    for name in DATASETS.values():
        dataset = bigquery.Dataset(f"{settings.project}.{name}")
        dataset.location = settings.location
        client.create_dataset(dataset, exists_ok=True)


def run_sql(client, sql: str, params: Iterable | None = None):
    from google.cloud import bigquery

    config = bigquery.QueryJobConfig(query_parameters=list(params or []))
    job = client.query(sql, job_config=config)
    job.result()
    return job


def run_sql_file(client, settings: Settings, cfg: ClientConfig, relpath: str, **extra: Any) -> None:
    text = (SQL_DIR / relpath).read_text(encoding="utf-8")
    run_sql(client, render_sql(text, template_vars(settings, cfg, **extra)))


def query_file_df(client, settings: Settings, cfg: ClientConfig, relpath: str, **extra: Any) -> pd.DataFrame:
    text = (SQL_DIR / relpath).read_text(encoding="utf-8")
    return client.query(render_sql(text, template_vars(settings, cfg, **extra))).to_dataframe()


def query_df(client, sql: str, params: Iterable | None = None) -> pd.DataFrame:
    from google.cloud import bigquery

    config = bigquery.QueryJobConfig(query_parameters=list(params or []))
    return client.query(sql, job_config=config).to_dataframe()


def table_exists(client, table: str) -> bool:
    from google.api_core.exceptions import NotFound

    try:
        client.get_table(table)
        return True
    except NotFound:
        return False


def load_df(client, df: pd.DataFrame, table: str, append: bool = False, schema: list | None = None) -> None:
    from google.cloud import bigquery

    config = bigquery.LoadJobConfig(
        write_disposition="WRITE_APPEND" if append else "WRITE_TRUNCATE",
        schema=schema,
    )
    client.load_table_from_dataframe(df, table, job_config=config).result()
