from __future__ import annotations

import argparse
import json
import logging
import sys

from . import audit, bq, crm, measurement, pipeline, privacy, propensity, segments
from .activation import campaigns, data_manager
from .config import ConfigError, Settings, load_client_config

COMMANDS = {
    "validate-config": "Validate the client YAML without touching BigQuery",
    "init": "Create the BigQuery datasets",
    "build": "Build staging, features and outcome tables",
    "crm": "Generate and load the synthetic CRM",
    "propensity": "Train and score the purchase-propensity model",
    "segments": "Build segment membership from the YAML rules",
    "privacy": "Normalise, consent-filter and hash identifiers",
    "measure": "Holdouts, backtest and A/A test",
    "check": "Run data-quality checks",
    "activate": "Build Customer Match payloads (dry run unless --live)",
    "campaigns": "Plan campaign structure (applied to the test account only with --live)",
    "audit": "Write the data audit report",
    "readout": "Write the client readout memo",
    "run-all": "Run the whole pipeline in dry-run mode",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="audiencebridge", description=__doc__)
    parser.add_argument("command", choices=COMMANDS, metavar="command", help="; ".join(f"{k}: {v}" for k, v in COMMANDS.items()))
    parser.add_argument("--live", action="store_true", help="activate/campaigns: really send to Google")
    parser.add_argument("--validate-only", action="store_true", help="activate --live: ask the API to validate only")
    parser.add_argument("--regen-crm", action="store_true", help="run-all: rebuild the synthetic CRM")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(message)s")
    try:
        if args.command == "validate-config":
            import os
            from pathlib import Path

            from .config import ROOT

            path = Path(os.environ.get("CLIENT_CONFIG", ROOT / "config" / "clients" / "gmerch_store.yaml"))
            cfg = load_client_config(path)
            print(f"OK: {cfg.client}, {len(cfg.segments)} segments")
            return 0

        settings = Settings.from_env()
        cfg = load_client_config(settings.client_config)
        if args.command == "campaigns":
            plan = campaigns.plan_campaigns(cfg)
            print(f"plan written to {campaigns.write_plan(plan)}")
            if args.live:
                print(json.dumps(campaigns.apply_plan(plan), indent=1))
            return 0

        client = bq.get_client(settings)
        if args.command == "init":
            pipeline.init(client, settings, cfg)
        elif args.command == "build":
            pipeline.build_models(client, settings, cfg)
        elif args.command == "crm":
            print(f"{crm.generate_and_load(client, settings, cfg):,} CRM rows loaded")
        elif args.command == "propensity":
            print(propensity.build(client, settings, cfg))
        elif args.command == "segments":
            print(segments.build(client, settings, cfg)[["segment_name", "size", "revenue_share"]])
        elif args.command == "privacy":
            measurement.assign_holdouts(client, settings, cfg)
            print(privacy.build_activation_tables(client, settings, cfg))
        elif args.command == "measure":
            result = measurement.run(client, settings, cfg)
            print(result["backtest"].to_string(index=False))
            print(result["aa"].to_string(index=False))
        elif args.command == "check":
            pipeline.run_checks(client, settings, cfg)
        elif args.command == "activate":
            report = data_manager.run(client, settings, cfg, live=args.live, validate_only=args.validate_only)
            print(json.dumps(report, indent=1))
        elif args.command == "audit":
            print(audit.run(client, settings, cfg))
        elif args.command == "readout":
            print(pipeline.make_readout(client, settings, cfg))
        elif args.command == "run-all":
            pipeline.run_all(client, settings, cfg, regenerate_crm=args.regen_crm)
    except ConfigError as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        logging.getLogger("audiencebridge").error("failed: %s", exc)
        if args.verbose:
            raise
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
