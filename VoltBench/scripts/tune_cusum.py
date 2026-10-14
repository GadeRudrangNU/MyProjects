"""Measures the CUSUM trade-off: average run length between false alarms against detection delay on a drift."""

import json
import sys
from pathlib import Path

import numpy as np

SAMPLE_HZ = 10
CLIP = 4.0
CHAINS = 4000
STEPS = 30000


def false_alarm_arl(k: float, h: float, rng: np.random.Generator) -> float:
    sp = np.zeros(CHAINS)
    sm = np.zeros(CHAINS)
    alarms = 0
    for _ in range(STEPS):
        x = np.clip(rng.standard_normal(CHAINS), -CLIP, CLIP)
        sp = np.maximum(0, sp + x - k)
        sm = np.maximum(0, sm - x - k)
        hit = (sp > h) | (sm > h)
        alarms += int(hit.sum())
        sp[hit] = 0
        sm[hit] = 0
    return CHAINS * STEPS / max(alarms, 1)


def delay_seconds(k: float, h: float, drift_sigma_per_sample: float, rng: np.random.Generator) -> float:
    chains = 2000
    sp = np.zeros(chains)
    sm = np.zeros(chains)
    found = np.full(chains, np.nan)
    for n in range(1, 4000):
        x = np.clip(rng.standard_normal(chains) + drift_sigma_per_sample * n, -CLIP, CLIP)
        sp = np.maximum(0, sp + x - k)
        sm = np.maximum(0, sm - x - k)
        new = ((sp > h) | (sm > h)) & np.isnan(found)
        found[new] = n
        if not np.isnan(found).any():
            break
    return float(np.nanmedian(found)) / SAMPLE_HZ


def main(out: Path):
    rng = np.random.default_rng(1)
    sigma_v = 0.005
    rates = [0.002, 0.005, 0.01, 0.05]
    lines = [
        "| k (sigma) | h (sigma) | false alarm every | " + " | ".join(f"drift {r} V/s" for r in rates) + " |",
        "|---|---|---|" + "---|" * len(rates),
    ]
    table = []
    for k in (0.5, 0.75, 1.0):
        for h in (5, 8, 10, 12):
            arl = false_alarm_arl(k, h, rng)
            delays = [delay_seconds(k, h, r * 1 / SAMPLE_HZ / sigma_v, rng) for r in rates]
            minutes = arl / SAMPLE_HZ / 60
            lines.append(f"| {k} | {h} | {minutes:.1f} min per signal | " + " | ".join(f"{d:.1f}s" for d in delays) + " |")
            table.append({"k": k, "h": h, "arl_samples": arl, "delay_s": dict(zip(map(str, rates), delays, strict=True))})
            print(lines[-1], flush=True)
    out.write_text("\n".join(lines) + "\n")
    (out.with_suffix(".json")).write_text(json.dumps(table, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "docs/cusum_tuning.md"))
