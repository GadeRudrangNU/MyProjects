import argparse
import json
import sys
from pathlib import Path

from .campaign import Config, run_campaign
from .scorecard import TARGETS, write_outputs


def main():
    parser = argparse.ArgumentParser(prog="evaluate")
    parser.add_argument("--campaign", required=True)
    parser.add_argument("--devices", type=int, default=50)
    parser.add_argument("--runs", type=int, default=40)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--plan", default="full_validation")
    parser.add_argument("--warmup", type=float, default=0.0)
    parser.add_argument("--lead-in", type=float, default=6.0)
    parser.add_argument("--severity-floor", type=float, default=0.0, help="skip the subtle end of each severity range (0 to 1)")
    parser.add_argument("--out", default="out")
    parser.add_argument("--gate", action="store_true", help="exit non-zero if detection or false alarm targets are missed")
    args = parser.parse_args()

    cfg = Config(args.campaign, args.devices, args.runs, args.seed, plan=args.plan, warmup_s=args.warmup, lead_in_s=args.lead_in, severity_floor=args.severity_floor)
    card = run_campaign(cfg)
    write_outputs(card, Path(args.out))
    print(json.dumps({"overall": card["overall"], "rates": card["rates"]}, indent=2))
    if args.gate:
        o = card["overall"]
        if (o["recall"] or 0) < TARGETS["recall"] or (o["false_alarm_rate"] or 0) > TARGETS["false_alarm_rate"]:
            print("quality gate failed", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
