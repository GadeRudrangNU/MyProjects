import json
import random
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from .scorecard import build_scorecard

GATEWAY = "http://127.0.0.1:8080"
LAB = "http://127.0.0.1:9100"
CATALOG = Path(__file__).resolve().parent.parent / "spec" / "catalog.json"


@dataclass
class Config:
    campaign: str
    devices: int
    runs: int
    seed: int
    plan: str = "full_validation"
    clean_fraction: float = 0.3
    lead_in_s: float = 6.0
    severity_floor: float = 0.0
    cooldown_s: float = 12.0
    warmup_s: float = 0.0
    pg_url: str = "postgresql://voltbench@127.0.0.1:5433/voltbench"
    gateway: str = GATEWAY
    lab: str = LAB


def draw_severity(rng: random.Random, spec: dict, floor: float = 0.0) -> float:
    lo, hi = spec["min"], spec["max"]
    if lo == hi:
        return float(lo)
    return round(rng.uniform(lo + floor * (hi - lo), hi), 4)


def plan_run(rng: random.Random, devices: list[dict], catalog: dict, clean_fraction: float, floor: float = 0.0) -> list[dict]:
    """Pick which devices stay clean and what single fault each of the others receives."""
    shuffled = devices[:]
    rng.shuffle(shuffled)
    n_clean = round(len(shuffled) * clean_fraction)
    faults = []
    for dev in shuffled[n_clean:]:
        applicable = sorted(t for t, s in catalog["faults"].items() if dev["type"] in s["applies"])
        ftype = rng.choice(applicable)
        faults.append({"device_id": dev["id"], "type": ftype, "severity": draw_severity(rng, catalog["faults"][ftype], floor)})
    return faults


def run_campaign(cfg: Config, log=print) -> dict:
    catalog = json.loads(CATALOG.read_text())
    rng = random.Random(cfg.seed)
    http = httpx.Client(timeout=30)
    all_devices = http.get(f"{cfg.gateway}/api/devices").json()
    devices = [d for d in all_devices if d["id"] <= cfg.devices]
    if len(devices) < cfg.devices:
        raise SystemExit(f"only {len(devices)} devices available")
    plans = http.get(f"{cfg.gateway}/api/test-plans").json()
    plan_id = next(p["id"] for p in plans if p["name"] == cfg.plan)
    http.delete(f"{cfg.lab}/faults")
    if cfg.warmup_s:
        log(f"warming up {cfg.warmup_s:.0f}s so the monitors learn their baselines")
        time.sleep(cfg.warmup_s)

    run_windows = []
    for i in range(cfg.runs):
        faults = plan_run(rng, devices, catalog, cfg.clean_fraction, cfg.severity_floor)
        faulty = {f["device_id"] for f in faults}
        t0 = time.time()
        for f in faults:
            resp = http.post(f"{cfg.lab}/faults", json={**f, "duration_s": 600, "campaign_id": cfg.campaign})
            resp.raise_for_status()
        time.sleep(cfg.lead_in_s)
        resp = http.post(
            f"{cfg.gateway}/api/test-runs",
            json={"plan_id": plan_id, "device_ids": [d["id"] for d in devices], "campaign_id": cfg.campaign, "seed": cfg.seed},
        )
        resp.raise_for_status()
        run_id = resp.json()["run_id"]
        while True:
            status = http.get(f"{cfg.gateway}/api/test-runs/{run_id}").json()["run"]["status"]
            if status in ("completed", "failed"):
                break
            time.sleep(1.5)
        http.delete(f"{cfg.lab}/faults")
        t1 = time.time()
        run_windows.append({"run_id": run_id, "start": t0, "end": t1, "faulty": sorted(faulty), "status": status})
        log(f"run {i + 1}/{cfg.runs}: id={run_id} {status} faults={len(faults)} took {t1 - t0:.0f}s")
        time.sleep(cfg.cooldown_s)
    return build_scorecard(cfg, catalog, devices, run_windows)
