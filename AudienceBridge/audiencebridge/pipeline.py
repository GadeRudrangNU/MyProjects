from __future__ import annotations

import logging
import time
from contextlib import contextmanager

from . import audit, bq, crm, measurement, privacy, propensity, quality, readout, segments
from .activation import campaigns, data_manager
from .config import ROOT, ClientConfig, Settings

log = logging.getLogger("audiencebridge")

MODEL_FILES = [
    "staging/stg_ga4_events.sql",
    "marts/user_features.sql",
    "marts/future_outcomes.sql",
]


@contextmanager
def step(name: str):
    start = time.time()
    log.info("-> %s", name)
    yield
    log.info("   done in %.1fs", time.time() - start)


def init(client, settings: Settings, cfg: ClientConfig) -> None:
    bq.ensure_datasets(client, settings)


def build_models(client, settings: Settings, cfg: ClientConfig) -> None:
    for path in MODEL_FILES:
        with step(path):
            bq.run_sql_file(client, settings, cfg, path)


def make_readout(client, settings: Settings, cfg: ClientConfig, activation_mode: str = "dry_run") -> str:
    rows = bq.query_df(client, f"SELECT * FROM `{bq.table_id(settings, 'measurement', 'dashboard_summary')}`").to_dict("records")
    metrics = None
    metrics_table = bq.table_id(settings, "measurement", "model_evaluation")
    if cfg.propensity_enabled and bq.table_exists(client, metrics_table):
        metrics = bq.query_df(client, f"SELECT * FROM `{metrics_table}` LIMIT 1").iloc[0].to_dict()
    text = readout.render_readout(
        rows,
        client_name=cfg.display_name,
        as_of=cfg.as_of_date.isoformat(),
        future_end=cfg.future_end_date.isoformat(),
        holdout_pct=cfg.holdout_pct,
        model_metrics=metrics,
        activation_mode=activation_mode,
    )
    path = ROOT / "reports" / f"readout_{cfg.as_of_date.isoformat()}.md"
    path.parent.mkdir(exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return str(path)


def run_checks(client, settings: Settings, cfg: ClientConfig) -> dict[str, int]:
    results = quality.run_checks(client, settings, cfg)
    for name, violations in results.items():
        log.info("   %-45s %s", name, "ok" if violations == 0 else f"FAILED ({violations})")
    failed = {k: v for k, v in results.items() if v}
    if failed:
        raise RuntimeError(f"data-quality checks failed: {failed}")
    return results


def run_all(client, settings: Settings, cfg: ClientConfig, regenerate_crm: bool = False) -> dict:
    with step("create datasets"):
        init(client, settings, cfg)
    build_models(client, settings, cfg)

    crm_table = bq.table_id(settings, "raw", "crm_customers")
    if regenerate_crm or not bq.table_exists(client, crm_table):
        with step("synthetic CRM"):
            log.info("   %s rows", f"{crm.generate_and_load(client, settings, cfg):,}")

    with step("propensity model"):
        metrics = propensity.build(client, settings, cfg)
        if metrics:
            log.info("   AUC %.3f (%s)", metrics.get("roc_auc", float("nan")), metrics["backend"])
    with step("segments"):
        summary = segments.build(client, settings, cfg)
        log.info("\n%s", summary[["segment_name", "size"]].to_string(index=False))
    with step("holdouts"):
        measurement.assign_holdouts(client, settings, cfg)
    with step("privacy layer"):
        funnel = privacy.build_activation_tables(client, settings, cfg)
        log.info("\n%s", funnel[["segment_name", "segment_size", "consented_size", "activatable_size"]].to_string(index=False))
    with step("measurement"):
        measurement.run(client, settings, cfg)
    with step("data-quality checks"):
        run_checks(client, settings, cfg)
    with step("activation (dry run)"):
        report = data_manager.run(client, settings, cfg, live=False)
    with step("campaign plan"):
        plan_path = campaigns.write_plan(campaigns.plan_campaigns(cfg))
        log.info("   %s", plan_path)
    with step("data audit"):
        audit.run(client, settings, cfg)
    with step("readout"):
        path = make_readout(client, settings, cfg)
        log.info("   %s", path)
    return {"activation": report}
