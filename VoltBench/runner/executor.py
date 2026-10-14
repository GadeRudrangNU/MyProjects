import asyncio
import math
import statistics
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

from . import expr
from .dsl import Step, TestSpec
from .gateway import GatewayClient, InfraError

FLUSH_MARGIN_S = 0.45


class TestFailure(Exception):
    __test__ = False


@dataclass
class Outcome:
    verdict: str
    measured: dict = field(default_factory=dict)
    limits: dict = field(default_factory=dict)
    steps: list = field(default_factory=list)
    message: str = ""
    attempt: int = 1
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    ended_at: datetime = field(default_factory=lambda: datetime.now(UTC))


def percentile(values: list[float], p: float) -> float:
    """Nearest-rank percentile: sort, take index ceil(p/100 * n) - 1."""
    if not values:
        raise ValueError("no values")
    ordered = sorted(values)
    return ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)]


def clean(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def signal_stats(points: list[float], sig: dict) -> dict:
    n = len(points)
    return {
        "count": n,
        "mean": statistics.fmean(points),
        "std": statistics.stdev(points) if n > 1 else 0.0,
        "min": min(points),
        "max": max(points),
        "out_of_limits": sum(1 for v in points if v < sig["hard"][0] or v > sig["hard"][1]),
        "nominal": sig["nominal"],
        "sigma": sig["sigma"],
        "range_lo": sig["range"][0],
        "range_hi": sig["range"][1],
        "hard_lo": sig["hard"][0],
        "hard_hi": sig["hard"][1],
    }


def crossing_time(points: list[tuple[int, float]], until: str, ctx: dict) -> float | None:
    """First time the condition becomes true, interpolating between samples."""
    prev = None
    for ts, value in points:
        if expr.evaluate(until, {**ctx, "value": value}):
            if prev is None:
                return float(ts)
            t0, v0 = prev
            lo, hi = 0.0, 1.0
            for _ in range(24):
                mid = (lo + hi) / 2
                if expr.evaluate(until, {**ctx, "value": v0 + (value - v0) * mid}):
                    hi = mid
                else:
                    lo = mid
            return t0 + (ts - t0) * hi
        prev = (ts, value)
    return None


class TestRun:
    __test__ = False

    def __init__(self, gw: GatewayClient, device: dict, spec: TestSpec, catalog: dict):
        self.gw = gw
        self.device = device
        self.spec = spec
        self.sigs = {s["name"]: s for s in catalog["types"][device["type"]]["signals"]}
        self.vars: dict = dict(spec.limits)
        self.vars["expected_firmware"] = device["expected_firmware"]
        self.vars["device_type"] = device["type"]
        self.measured: dict = {}
        self.steps: list = []
        self.samples: dict[str, dict] = {}
        self.last_cmd: dict | None = None
        self.ack_at_ms = 0

    async def run(self) -> Outcome:
        out = Outcome("PASS", limits=dict(self.spec.limits))
        out.started_at = datetime.now(UTC)
        try:
            for i, step in enumerate(self.spec.steps):
                began = time.monotonic()
                entry = {"index": i + 1, "kind": step.kind, "ok": True, "ms": 0, "detail": ""}
                self.steps.append(entry)
                try:
                    entry["detail"] = await self._step(step) or ""
                except TestFailure as e:
                    entry.update(ok=False, detail=str(e))
                    raise
                finally:
                    entry["ms"] = round((time.monotonic() - began) * 1000)
        except TestFailure as e:
            out.verdict, out.message = "FAIL", str(e)
        except InfraError as e:
            out.verdict, out.message = "ERROR", str(e)
        except expr.ExprError as e:
            out.verdict, out.message = "ERROR", f"test definition error: {e}"
        out.ended_at = datetime.now(UTC)
        out.measured = clean({**self.measured, "vars": {k: v for k, v in self.vars.items() if k not in self.spec.limits}})
        out.steps = self.steps
        return out

    async def _step(self, step: Step) -> str:
        if step.command:
            return await self._command(step)
        if step.sample:
            return await self._sample(step)
        if step.measure:
            return await self._measure(step)
        if step.link:
            return await self._link(step)
        if step.wait_online:
            return await self._wait_online(step)
        if step.assert_:
            return self._assert(step.assert_)
        if step.assert_each:
            return self._assert_each(step.assert_each)
        await asyncio.sleep(step.sleep_ms / 1000)
        return f"slept {step.sleep_ms} ms"

    async def _command(self, step: Step) -> str:
        timeout = step.expect_ack_within_ms or 1500
        latencies = []
        for _ in range(step.repeat):
            res = await self.gw.command(self.device["id"], step.command, step.args, timeout)
            if res["timed_out"]:
                raise TestFailure(f"{step.command}: no ACK within {timeout} ms")
            if res["nack"]:
                raise TestFailure(f"{step.command}: device replied NACK")
            latencies.append(res["latency_ms"])
            self.last_cmd = res
            self.ack_at_ms = res["sent_ts_ms"] + res["latency_ms"]
        if step.record_latency_as:
            self.vars[step.record_latency_as] = percentile(latencies, 95)
            self.measured[step.record_latency_as] = self.vars[step.record_latency_as]
            self.measured["ack_latency_ms"] = {"min": min(latencies), "max": max(latencies), "n": len(latencies)}
        if step.record_version_as:
            self.vars[step.record_version_as] = (self.last_cmd.get("data") or {}).get("version", "")
            self.measured[step.record_version_as] = self.vars[step.record_version_as]
        return f"{step.command} acked in {latencies[-1]:.1f} ms"

    async def _sample(self, step: Step) -> str:
        spec = step.sample
        start = int(time.time() * 1000)
        await asyncio.sleep(spec.duration_ms / 1000 + FLUSH_MARGIN_S)
        points = await self.gw.telemetry(self.device["id"], start, start + spec.duration_ms)
        names = [n for n, s in self.sigs.items() if s["monitored"]] if spec.signals == "monitored" else spec.signals
        by_signal: dict[str, list[float]] = {n: [] for n in names}
        for p in points:
            if p["signal"] in by_signal:
                by_signal[p["signal"]].append(p["value"])
        if not any(by_signal.values()):
            raise TestFailure("no telemetry received from the device")
        starved = [n for n, v in by_signal.items() if len(v) < 5]
        if starved:
            raise TestFailure(f"too few samples for {', '.join(starved)}")
        self.samples = {n: signal_stats(v, self.sigs[n]) for n, v in by_signal.items()}
        self.measured["signals"] = {n: {k: round(v, 6) if isinstance(v, float) else v for k, v in s.items()} for n, s in self.samples.items()}
        return f"{sum(len(v) for v in by_signal.values())} samples over {len(names)} signals"

    async def _measure(self, step: Step) -> str:
        spec = step.measure
        if self.last_cmd is None:
            raise expr.ExprError("measure needs a preceding command")
        sent = self.last_cmd["sent_ts_ms"]
        await asyncio.sleep(spec.timeout_ms / 1000 + FLUSH_MARGIN_S)
        pts = await self.gw.telemetry(self.device["id"], sent - 150, sent + spec.timeout_ms, spec.signal)
        series = sorted((p["ts"], p["value"]) for p in pts)
        # Start from the last sample before the command so a crossing in the first interval interpolates.
        series = [s for s in series if s[0] >= sent - 150]
        if not series:
            raise TestFailure("no telemetry received during measurement")
        hit = crossing_time(series, spec.until, self.vars)
        if hit is None:
            self.vars[spec.record_as] = math.inf
            self.measured[spec.record_as] = None
            raise TestFailure(f"'{spec.until}' not reached within {spec.timeout_ms} ms")
        self.vars[spec.record_as] = round(hit - sent, 2)
        self.measured[spec.record_as] = self.vars[spec.record_as]
        return f"{spec.record_as} = {self.vars[spec.record_as]} ms"

    async def _link(self, step: Step) -> str:
        spec = step.link
        before = await self.gw.device(self.device["id"])
        await asyncio.sleep(spec.duration_ms / 1000)
        after = await self.gw.device(self.device["id"])
        frames = after["frames"] - before["frames"]
        lost = after["lost"] - before["lost"]
        crc = after["crc_errors"] - before["crc_errors"]
        if frames <= 0:
            raise TestFailure("no frames received from the device")
        self.vars[spec.record_loss_as] = 100 * lost / (frames + lost)
        self.vars[spec.record_crc_as] = 100 * crc / (frames + crc)
        self.measured.update({spec.record_loss_as: self.vars[spec.record_loss_as], spec.record_crc_as: self.vars[spec.record_crc_as], "frames": frames, "lost": lost, "crc_errors": crc})
        return f"{frames} frames, {lost} lost, {crc} corrupt"

    async def _wait_online(self, step: Step) -> str:
        spec = step.wait_online
        before = (await self.gw.device(self.device["id"]))["boots"]
        deadline = time.monotonic() + spec.timeout_ms / 1000
        while time.monotonic() < deadline:
            snap = await self.gw.device(self.device["id"])
            if snap["boots"] > before:
                self.vars[spec.record_as] = max(0.0, snap["last_boot_ms"] - self.ack_at_ms)
                self.measured[spec.record_as] = self.vars[spec.record_as]
                return f"back online after {self.vars[spec.record_as]:.0f} ms"
            await asyncio.sleep(0.05)
        self.vars[spec.record_as] = math.inf
        self.measured[spec.record_as] = None
        raise TestFailure(f"device did not come back within {spec.timeout_ms} ms")

    def _assert(self, text: str) -> str:
        if not expr.evaluate(text, self.vars):
            shown = {n: self.vars.get(n) for n in sorted(expr.names(text)) if n in self.vars}
            raise TestFailure(f"assertion failed: {text}  ({shown})")
        return text

    def _assert_each(self, text: str) -> str:
        if not self.samples:
            raise expr.ExprError("assert_each needs a preceding sample step")
        failed = []
        for name, stats in self.samples.items():
            if not expr.evaluate(text, {**self.vars, **stats, "signal": name}):
                failed.append(name)
            self.measured["signals"][name]["passed"] = name not in failed
        if failed:
            raise TestFailure(f"assertion failed for {', '.join(failed)}: {text}")
        return text


def applicable(spec_device_type: str, device_type: str) -> bool:
    return spec_device_type in ("ANY", device_type)


async def run_with_retry(gw: GatewayClient, device: dict, spec: TestSpec, catalog: dict, retries: int = 1) -> Outcome:
    first = await TestRun(gw, device, spec, catalog).run()
    if first.verdict != "FAIL" or retries < 1:
        return first
    second = await TestRun(gw, device, spec, catalog).run()
    second.started_at = first.started_at
    second.attempt = 2
    if second.verdict == "PASS":
        second.verdict = "FLAKY"
        second.message = f"failed once, then passed on retry: {first.message}"
        second.measured = {**second.measured, "first_attempt": first.measured}
    return second
