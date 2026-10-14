import json
import statistics
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from . import metrics as m

TARGETS = {"recall": 0.95, "precision": 0.95, "false_alarm_rate": 0.02, "flaky_rate": 0.01, "error_rate": 0.005}


def _epoch(ts) -> float:
    return ts.timestamp()


def load(cfg, since: float):
    with psycopg.connect(cfg.pg_url) as conn:
        faults = [
            {"id": r[0], "device_id": r[1], "type": r[2], "severity": r[3], "start_at": _epoch(r[4]), "end_at": _epoch(r[5])}
            for r in conn.execute(
                "SELECT id, device_id, type, severity, start_at, end_at FROM lab.fault_injections WHERE campaign_id = %s",
                (cfg.campaign,),
            )
        ]
        results = [
            {"run_id": r[0], "device_id": r[1], "kind": r[2], "test": r[3], "verdict": r[4],
             "started_at": _epoch(r[5]), "ended_at": _epoch(r[6]), "attempt": r[7]}
            for r in conn.execute(
                "SELECT res.run_id, res.device_id, td.kind, td.name, res.verdict, res.started_at, res.ended_at, res.attempt"
                " FROM test_results res JOIN test_runs tr ON tr.id = res.run_id"
                " JOIN test_definitions td ON td.id = res.test_definition_id WHERE tr.campaign_id = %s",
                (cfg.campaign,),
            )
        ]
        alerts = [
            {"device_id": r[0], "rule": r[1], "ts": _epoch(r[2])}
            for r in conn.execute("SELECT device_id, rule, ts FROM alerts WHERE ts >= %s", (datetime.fromtimestamp(since, tz=UTC),))
        ]
        runs = [
            {"id": r[0], "started": _epoch(r[1]), "finished": _epoch(r[2]), "devices": len(r[3])}
            for r in conn.execute(
                "SELECT id, started_at, finished_at, device_ids FROM test_runs WHERE campaign_id = %s AND finished_at IS NOT NULL ORDER BY id",
                (cfg.campaign,),
            )
        ]
    return faults, results, alerts, runs


def _stats(values):
    if not values:
        return {"n": 0, "mean": None, "median": None, "p95": None}
    return {"n": len(values), "mean": statistics.fmean(values), "median": statistics.median(values), "p95": m.percentile(values, 95)}


def build_scorecard(cfg, catalog, devices, run_windows) -> dict:
    since = min(w["start"] for w in run_windows) - 5
    faults, results, alerts, runs = load(cfg, since)
    rows = m.label_rows(results, faults)

    overall = m.confusion(rows)
    by_kind = {}
    for kind in m.ALL_KINDS:
        subset = [r for r in rows if r["kind"] == kind]
        if subset:
            by_kind[kind] = m.confusion(subset)
    by_type = m.per_fault_type(rows, faults)

    test_detected = {f["id"]: any(r["predicted"] for r in rows if f["id"] in r["fault_ids"]) for f in faults}
    ttd = m.time_to_detect(faults, alerts)
    curve = m.detection_by_severity(faults, test_detected, ttd, catalog["faults"])

    detected_types = {f["type"] for f in faults if test_detected[f["id"]]}
    injected_types = {f["type"] for f in faults}

    faulty_device_runs = defaultdict(set)
    for f in faults:
        run = next((w for w in run_windows if w["start"] <= f["start_at"] <= w["end"]), None)
        if run:
            faulty_device_runs[(run["run_id"], f["device_id"])].add(f["type"])
    failing = {(r["run_id"], r["device_id"]) for r in rows if r["predicted"]}
    device_level = m.rate(sum(1 for k in faulty_device_runs if k in failing), len(faulty_device_runs))

    clean_total = clean_alerted = 0
    for w in run_windows:
        for d in devices:
            if d["id"] in w["faulty"]:
                continue
            clean_total += 1
            if any(a["device_id"] == d["id"] and w["start"] <= a["ts"] <= w["end"] for a in alerts):
                clean_alerted += 1

    visible = [f for f in faults if f["type"] in m.MONITOR_RULES]
    times = [t for f in visible if (t := ttd.get(f["id"])) is not None]
    monitor_by_type = {}
    for ftype in m.MONITOR_RULES:
        subset = [f for f in faults if f["type"] == ftype]
        if subset:
            hits = [ttd[f["id"]] for f in subset if ttd.get(f["id"]) is not None]
            monitor_by_type[ftype] = {"injected": len(subset), "detected": len(hits), "mttd": _stats(hits)}

    verdicts = defaultdict(int)
    for r in results:
        verdicts[r["verdict"]] += 1
    total = len(results)

    card = {
        "campaign_id": cfg.campaign,
        "created_at": datetime.now(UTC).isoformat(),
        "config": {"devices": cfg.devices, "runs": cfg.runs, "seed": cfg.seed, "plan": cfg.plan, "clean_fraction": cfg.clean_fraction, "severity_floor": cfg.severity_floor},
        "totals": {"results": total, "evaluated": len(rows), "faults_injected": len(faults), **verdicts},
        "overall": overall,
        "rates": {
            "flaky_rate": m.rate(verdicts["FLAKY"], total),
            "error_rate": m.rate(verdicts["ERROR"], total),
            "fault_coverage": f"{len(detected_types)}/{len(injected_types)}",
            "device_level_detection": device_level,
        },
        "targets": TARGETS,
        "by_kind": by_kind,
        "by_fault_type": by_type,
        "severity_curve": curve,
        "monitor": {
            "detection_rate": m.rate(len(times), len(visible)),
            "false_alarm_rate": m.rate(clean_alerted, clean_total),
            "clean_device_runs": clean_total,
            "mttd_s": _stats(times),
            "mttd_histogram": m.histogram(times, 10),
            "by_fault_type": monitor_by_type,
        },
        "platform": {
            "plan_seconds": _stats([r["finished"] - r["started"] for r in runs]),
            "devices_per_run": cfg.devices,
        },
    }
    with psycopg.connect(cfg.pg_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO scorecards (campaign_id, data) VALUES (%s, %s)"
            " ON CONFLICT (campaign_id) DO UPDATE SET data = EXCLUDED.data, created_at = now()",
            (cfg.campaign, Jsonb(card)),
        )
    return card


def pct(v, digits=1):
    return "n/a" if v is None else f"{100 * v:.{digits}f}%"


def write_outputs(card: dict, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"scorecard_{card['campaign_id']}.json").write_text(json.dumps(card, indent=2))
    o, r, mon = card["overall"], card["rates"], card["monitor"]
    cfg = card["config"]
    lines = [
        f"## Validation results: campaign {card['campaign_id']}",
        "",
        f"{cfg['devices']} devices, {cfg['runs']} runs, seed {cfg['seed']}, about {int(cfg['clean_fraction'] * 100)}% of devices left clean each run. "
        f"{card['totals']['faults_injected']} faults injected, {card['totals']['evaluated']} test results scored.",
        "",
        "| Metric | Result | Target |",
        "|---|---|---|",
        f"| Detection rate (recall) | {pct(o['recall'])} | >= 95% |",
        f"| Precision | {pct(o['precision'])} | >= 95% |",
        f"| False alarm rate | {pct(o['false_alarm_rate'])} | <= 2% |",
        f"| F1 | {pct(o['f1'])} | |",
        f"| Fault coverage | {r['fault_coverage']} | all types |",
        f"| Device-level detection | {pct(r['device_level_detection'])} | |",
        f"| Flaky rate | {pct(r['flaky_rate'], 2)} | <= 1% |",
        f"| Infra error rate | {pct(r['error_rate'], 2)} | <= 0.5% |",
        f"| Monitor detection (visible faults) | {pct(mon['detection_rate'])} | |",
        f"| Monitor false alarms (clean device-runs) | {pct(mon['false_alarm_rate'])} | |",
    ]
    if mon["mttd_s"]["n"]:
        s = mon["mttd_s"]
        lines.append(f"| Mean time to detect | {s['mean']:.1f}s (median {s['median']:.1f}s, p95 {s['p95']:.1f}s) | |")
    lines += ["", "| Fault type | Injected | Caught by tests | Recall |", "|---|---|---|---|"]
    for t, v in card["by_fault_type"].items():
        lines.append(f"| {t} | {v['injected']} | {v['tp']} of {v['tp'] + v['fn']} | {pct(v['recall'])} |")
    (out_dir / f"results_{card['campaign_id']}.md").write_text("\n".join(lines) + "\n")
