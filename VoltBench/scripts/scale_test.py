"""Brings the platform up at increasing fleet sizes and records throughput, resource use and latency."""

import asyncio
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import httpx
import matplotlib
import psutil
import websockets

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stack import GATEWAY, Stack  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SIZES = [10, 50, 100, 250, 500, 1000]
SETTLE_S = 12
WINDOW_S = 20


def scrape() -> dict:
    text = urllib.request.urlopen(f"{GATEWAY}/metrics", timeout=5).read().decode()
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([a-z_]+(?:\{[^}]*\})?)\s+([0-9.e+\-]+)$", line)
        if m:
            out[m.group(1)] = float(m.group(2))
    return out


def histogram_quantile(q: float, before: dict, after: dict, name: str) -> float | None:
    buckets = []
    for key, value in after.items():
        m = re.match(rf'^{name}_bucket\{{le="([^"]+)"\}}$', key)
        if m and m.group(1) != "+Inf":
            buckets.append((float(m.group(1)), value - before.get(key, 0)))
    count = after.get(f"{name}_count", 0) - before.get(f"{name}_count", 0)
    if not count:
        return None
    for le, cum in sorted(buckets):
        if cum >= q * count:
            return le
    return None


async def browser_latency(seconds: float) -> list[float]:
    latencies = []
    url = GATEWAY.replace("http", "ws") + "/ws/telemetry?devices=1,2,3"
    async with websockets.connect(url) as ws:
        end = time.time() + seconds
        while time.time() < end:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 2))
            except TimeoutError:
                continue
            latencies.append(time.time() * 1000 - msg["ts_ms"])
    return latencies


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    import math

    return ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)]


def process_named(fragment: str) -> list[psutil.Process]:
    """The matching process plus its children, since the venv launcher is a thin parent."""
    procs = []
    for proc in psutil.process_iter(["cmdline"]):
        cmd = " ".join(proc.info["cmdline"] or [])
        if fragment in cmd and "scale_test" not in cmd:
            procs.append(proc)
    return procs


def cpu(procs: list[psutil.Process]) -> float:
    return sum(p.cpu_percent(None) for p in procs) / psutil.cpu_count()


def measure(devices: int) -> dict:
    with Stack(devices=devices, baseline_seconds=30, fresh=False):
        time.sleep(SETTLE_S)
        gw = process_named("gateway.exe") or process_named("gateway")
        sim = process_named("-m simulator")
        cpu(gw)
        cpu(sim)
        before = scrape()
        t0 = time.time()
        latencies = asyncio.run(browser_latency(WINDOW_S))
        elapsed = time.time() - t0
        after = scrape()
        gw_cpu, sim_cpu = cpu(gw), cpu(sim)
        cmd_ms = []
        with httpx.Client(base_url=GATEWAY, timeout=10) as http:
            for i in range(60):
                res = http.post(f"/api/devices/{1 + i % devices}/commands", json={"cmd": "GET_VERSION"}).json()
                if res.get("ack"):
                    cmd_ms.append(res["latency_ms"])
        frames = after["frames_decoded_total"] - before["frames_decoded_total"]
        online = int(after.get('devices_by_status{status="ONLINE"}', 0))
        return {
            "devices": devices,
            "online": online,
            "frames_per_s": frames / elapsed,
            "expected_frames_per_s": devices * 11,
            "gateway_cpu_pct": gw_cpu,
            "gateway_mem_mb": sum(p.memory_info().rss for p in gw) / 1e6,
            "simulator_cpu_pct": sim_cpu,
            "browser_latency_ms": {"p50": pct(latencies, 50), "p95": pct(latencies, 95), "p99": pct(latencies, 99)},
            "command_ack_p95_ms": pct(cmd_ms, 95),
            "mongo_batch_p95_s": histogram_quantile(0.95, before, after, "mongo_batch_write_seconds"),
            "frames_lost": after["frames_lost_total"] - before["frames_lost_total"],
        }


def plot(rows: list[dict], path: Path):
    xs = [r["devices"] for r in rows]
    fig, axes = plt.subplots(1, 3, figsize=(13, 3.6))
    axes[0].plot(xs, [r["frames_per_s"] for r in rows], marker="o", color="#2b8cbe", label="decoded")
    axes[0].plot(xs, [r["expected_frames_per_s"] for r in rows], ls="--", color="#999", label="offered")
    axes[0].set(title="Frames per second", xlabel="devices")
    axes[0].legend(frameon=False)
    axes[1].plot(xs, [r["gateway_cpu_pct"] for r in rows], marker="o", color="#e6550d", label="gateway CPU %")
    axes[1].plot(xs, [r["simulator_cpu_pct"] for r in rows], marker="o", color="#756bb1", label="simulator CPU %")
    ax2 = axes[1].twinx()
    ax2.plot(xs, [r["gateway_mem_mb"] for r in rows], marker="s", color="#31a354", label="gateway MB")
    axes[1].set(title="CPU (of whole machine) and memory", xlabel="devices")
    axes[1].legend(frameon=False, loc="upper left")
    ax2.legend(frameon=False, loc="lower right")
    axes[2].plot(xs, [r["browser_latency_ms"]["p50"] for r in rows], marker="o", label="p50")
    axes[2].plot(xs, [r["browser_latency_ms"]["p95"] for r in rows], marker="o", label="p95")
    axes[2].plot(xs, [r["command_ack_p95_ms"] for r in rows], marker="o", label="ACK p95")
    axes[2].set(title="Latency (ms)", xlabel="devices")
    axes[2].legend(frameon=False)
    for ax in axes:
        ax.set_xscale("log")
        ax.set_xticks(xs)
        ax.set_xticklabels(xs)
        ax.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(path, dpi=130)


def main():
    out = Path("docs")
    rows = []
    for size in SIZES:
        print(f"measuring {size} devices", flush=True)
        row = measure(size)
        print(json.dumps(row), flush=True)
        rows.append(row)
        (out / "scale.json").write_text(json.dumps(rows, indent=2))
    plot(rows, out / "scale.png")


if __name__ == "__main__":
    main()
