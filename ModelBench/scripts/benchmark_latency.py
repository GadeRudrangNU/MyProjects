"""Measure end-to-end /api/predict latency (HTTP round trip included) with the stdlib only.

    python scripts/benchmark_latency.py --model-id 1 --requests 200

Prints p50/p95/p99 so any latency claim in the README is backed by a number you measured
on your own machine.
"""
import argparse
import json
import statistics
import time
import urllib.request

SENTENCES = [
    "The film was a delight from start to finish.",
    "Terrible service and the food was cold.",
    "I did not expect to enjoy it this much.",
    "A dull, predictable and overlong sequel.",
]


def pct(sorted_vals: list[float], q: float) -> float:
    pos = (len(sorted_vals) - 1) * q / 100
    lo, hi = int(pos), min(int(pos) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def call(base: str, model_id: int, text: str) -> float:
    req = urllib.request.Request(
        f"{base}/api/predict",
        data=json.dumps({"model_id": model_id, "text": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    start = time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()
    return (time.perf_counter() - start) * 1000


def main() -> None:
    ap = argparse.ArgumentParser()
    # 127.0.0.1, not "localhost": on Windows the name lookup can add ~200 ms per connection
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--model-id", type=int, required=True)
    ap.add_argument("--requests", type=int, default=200)
    ap.add_argument("--warmup", type=int, default=5)
    args = ap.parse_args()

    for i in range(args.warmup):  # first calls load the model; don't count them
        call(args.base, args.model_id, SENTENCES[i % len(SENTENCES)])
    lat = sorted(call(args.base, args.model_id, SENTENCES[i % len(SENTENCES)]) for i in range(args.requests))

    print(f"requests={len(lat)}  mean={statistics.mean(lat):.1f} ms")
    for q in (50, 95, 99):
        print(f"p{q}={pct(lat, q):.1f} ms")
    print(f"max={lat[-1]:.1f} ms")


if __name__ == "__main__":
    main()
