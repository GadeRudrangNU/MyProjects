"""Synthetic traffic against a running PayFlow API, with ground truth.

Customers, merchants, amounts' timing, retries and refunds are synthetic. The fraud signal is
not: every payment replays a *real* transaction (its anonymised features and amount) from the
held-out slice of the public ULB credit-card dataset, so the fraud label is genuine and the
live precision/recall printed at the end can be compared with the offline evaluation.

    python scripts/simulate_traffic.py --api http://127.0.0.1:8000 --key pf_test_... --payments 400

The script also runs a local webhook receiver that verifies signatures and fails a share of
requests on purpose, so retries and backoff are exercised end to end.
Exit status is non-zero if reconciliation finds a mismatch or an idempotent replay differs.
"""

import argparse
import csv
import gzip
import json
import random
import sys
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
SAMPLE = ROOT / "ml" / "sample" / "holdout_sample.csv.gz"
sys.path.insert(0, str(ROOT / "backend"))
from webhooks.signing import SIGNATURE_HEADER, verify_signature  # noqa: E402


def load_rows():
    with gzip.open(SAMPLE, "rt") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        row["signals"] = [float(row[f"V{i}"]) for i in range(1, 29)]
        row["cents"] = min(500_000, max(100, round(float(row["Amount"]) * 100)))
        row["fraud"] = row["Class"] == "1"
    return [r for r in rows if not r["fraud"]], [r for r in rows if r["fraud"]]


class Receiver:
    """Merchant-side webhook endpoint that checks signatures and flakes on purpose."""

    def __init__(self, port: int, secret: str, failure_rate: float):
        self.secret, self.failure_rate = secret, failure_rate
        self.ok, self.failed, self.bad_signature = 0, 0, 0
        self.seen = Counter()
        self.lock = threading.Lock()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                valid = verify_signature(outer.secret, self.headers.get(SIGNATURE_HEADER, ""), body)
                with outer.lock:
                    if not valid:
                        outer.bad_signature += 1
                    flake = random.random() < outer.failure_rate
                    if flake:
                        outer.failed += 1
                    else:
                        outer.ok += 1
                        outer.seen[json.loads(body)["type"]] += 1
                self.send_response(500 if flake or not valid else 200)
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


class Api:
    def __init__(self, base: str, key: str):
        self.http = httpx.Client(base_url=base, headers={"Authorization": f"Bearer {key}"}, timeout=30)

    def call(self, method, path, body=None, key=None):
        headers = {"Idempotency-Key": key or uuid.uuid4().hex} if method == "POST" else {}
        started = time.perf_counter()
        response = self.http.request(method, path, json=body, headers=headers)
        return response, (time.perf_counter() - started) * 1000


def percentile(values, q):
    values = sorted(values)
    return values[min(len(values) - 1, int(len(values) * q))] if values else 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--key", required=True)
    parser.add_argument("--payments", type=int, default=300)
    parser.add_argument("--customers", type=int, default=300)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--fraud-share", type=float, default=0.04, help="share of payments replaying a real fraud row")
    parser.add_argument("--duplicate-share", type=float, default=0.08, help="share of requests sent twice with one key")
    parser.add_argument("--burst", type=int, default=12, help="rapid payments from one customer (velocity demo)")
    parser.add_argument("--webhook-port", type=int, default=9099)
    parser.add_argument("--webhook-failure-rate", type=float, default=0.2)
    parser.add_argument("--resolve-reviews", action="store_true", help="act as the analyst using ground truth")
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()
    random.seed(args.seed)

    legit_rows, fraud_rows = load_rows()
    api = Api(args.api, args.key)

    # -- webhook endpoint -------------------------------------------------------------
    endpoint = api.http.get("/api/v1/webhooks/endpoint").json()
    receiver = Receiver(args.webhook_port, endpoint["secret"], args.webhook_failure_rate)
    api.http.put("/api/v1/webhooks/endpoint", json={"url": f"http://127.0.0.1:{args.webhook_port}/hooks"})

    # -- accounts ---------------------------------------------------------------------
    merchants = [
        api.call("POST", "/api/v1/accounts", {"name": f"Merchant {i}", "kind": "merchant"})[0].json() for i in range(4)
    ]
    customers = []
    for i in range(args.customers):
        account = api.call("POST", "/api/v1/accounts", {"name": f"Customer {i:03d}", "kind": "customer"})[0].json()
        funds = random.choice([20_000, 80_000, 250_000, 600_000, 1_500_000])
        api.call("POST", f"/api/v1/accounts/{account['id']}/deposit", {"amount": funds})
        customers.append({"id": account["id"], "devices": [f"dev-{uuid.uuid4().hex[:8]}"], "funds": funds})
    print(f"setup: {len(merchants)} merchants, {len(customers)} customers")

    # -- traffic ---------------------------------------------------------------------
    latencies, outcomes, truth = [], Counter(), {}
    replay_mismatches = []
    refunds_ok = refunds_rejected = captures = 0
    lock = threading.Lock()

    order = random.sample(customers, len(customers))

    def one_payment(i):
        nonlocal refunds_ok, refunds_rejected, captures
        is_fraud = random.random() < args.fraud_share
        row = random.choice(fraud_rows if is_fraud else legit_rows)
        customer = order[i % len(order)]  # humans pay a few times an hour, not a few times a second
        device = customer["devices"][0] if random.random() > 0.02 else f"dev-{uuid.uuid4().hex[:8]}"
        two_step = random.random() < 0.1
        body = {
            "payer_id": customer["id"],
            "payee_id": random.choice(merchants)["id"],
            "amount": row["cents"],
            "device_id": device,
            "risk_signals": row["signals"],
            "capture": not two_step,
            "description": "synthetic order",
        }
        key = uuid.uuid4().hex
        response, ms = api.call("POST", "/api/v1/payments", body, key)
        payment = response.json()
        with lock:
            latencies.append(ms)
            outcomes[(payment.get("status"), payment.get("failure_reason") or "")] += 1
            truth[payment["id"]] = row["fraud"]
        if random.random() < args.duplicate_share:  # the client retries after a timeout
            again, _ms = api.call("POST", "/api/v1/payments", body, key)
            if again.json() != payment or again.status_code != response.status_code:
                with lock:
                    replay_mismatches.append(payment["id"])
        if payment.get("status") == "authorized":
            api.call("POST", f"/api/v1/payments/{payment['id']}/capture")
            with lock:
                captures += 1
        if payment.get("status") in {"captured", "authorized"} and random.random() < 0.1:
            refund = api.call(
                "POST", "/api/v1/refunds", {"payment_id": payment["id"], "amount": max(1, row["cents"] // 2)}
            )[0]
            with lock:
                if refund.status_code == 201:
                    refunds_ok += 1
                else:
                    refunds_rejected += 1

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(one_payment, range(args.payments)))
    elapsed = time.perf_counter() - started

    # -- velocity burst: one customer hammering the API ----------------------------------
    burst_decisions = Counter()
    if args.burst:
        attacker = customers[0]
        for _ in range(args.burst):
            row = random.choice(legit_rows)
            response, _ms = api.call(
                "POST",
                "/api/v1/payments",
                {
                    "payer_id": attacker["id"],
                    "payee_id": merchants[0]["id"],
                    "amount": min(row["cents"], 2_000),
                    "risk_signals": row["signals"],
                },
            )
            burst_decisions[response.json()["fraud_decision"]] += 1

    # -- analyst -------------------------------------------------------------------
    resolved = 0
    if args.resolve_reviews:
        queue = api.http.get("/api/v1/fraud/review-queue", params={"limit": 500}).json()["results"]
        for item in queue:
            decision = "reject" if truth.get(item["payment"]["id"]) else "approve"
            api.call("POST", f"/api/v1/fraud/review/{item['payment']['id']}/resolve", {"decision": decision})
            resolved += 1

    # -- live fraud quality vs ground truth ------------------------------------------------
    payments = []
    offset = 0
    while True:
        page = api.http.get("/api/v1/payments", params={"limit": 500, "offset": offset}).json()
        payments += page["results"]
        offset += 500
        if not page["next"]:
            break
    tp = fp = fn = tn = 0
    for p in payments:
        if p["id"] not in truth:
            continue
        flagged = p["fraud_decision"] in {"review", "block"}
        real = truth[p["id"]]
        tp += flagged and real
        fp += flagged and not real
        fn += (not flagged) and real
        tn += (not flagged) and not real

    # -- webhooks: give the retry machinery time to drain -------------------------------
    deadline = time.time() + 120
    while time.time() < deadline:
        stats = api.http.get("/api/v1/webhooks/deliveries", params={"status": "pending", "limit": 1}).json()
        if stats["count"] == 0:
            break
        time.sleep(2)
    deliveries = {
        s: api.http.get("/api/v1/webhooks/deliveries", params={"status": s, "limit": 1}).json()["count"]
        for s in ("delivered", "pending", "dead")
    }

    # -- reconciliation -------------------------------------------------------------
    run = api.call("POST", "/api/v1/reconciliation/runs")[0].json()
    overview = api.http.get("/api/v1/stats/overview").json()

    by_status = Counter()
    for (status, reason), n in outcomes.items():
        by_status[f"{status}{' (' + reason + ')' if reason else ''}"] += n
    print("\n== results ==")
    print(
        f"payments sent: {args.payments} in {elapsed:.1f}s  ({args.payments / elapsed:.1f}/s with {args.workers} workers)"
    )
    print(
        "client latency ms: p50 {:.0f}  p95 {:.0f}  p99 {:.0f}".format(
            *(percentile(latencies, q) for q in (0.5, 0.95, 0.99))
        )
    )
    for k, v in sorted(by_status.items()):
        print(f"  {k:<32}{v}")
    print(
        f"two-step captures: {captures}   refunds ok/rejected: {refunds_ok}/{refunds_rejected}   reviews resolved: {resolved}"
    )
    if args.burst:
        print(f"velocity burst of {args.burst} rapid payments from one customer: {dict(burst_decisions)}")
    print(f"idempotent replays that differed from the original: {len(replay_mismatches)}")
    precision = tp / (tp + fp) if tp + fp else float("nan")
    recall = tp / (tp + fn) if tp + fn else float("nan")
    print(
        f"live fraud detection vs real labels: flagged tp={tp} fp={fp} fn={fn} tn={tn}  precision={precision:.2f} recall={recall:.2f}"
        f"  fpr={fp / (fp + tn) * 100 if fp + tn else 0:.2f}%"
    )
    print(
        f"webhooks: receiver ok={receiver.ok} injected failures={receiver.failed} bad signatures={receiver.bad_signature}; deliveries {deliveries}"
    )
    print(
        f"reconciliation: {run['status']} ({run['accounts_checked']} accounts, {run['transactions_checked']} ledger transactions, {run['mismatch_count']} findings)"
    )
    print(f"dashboard 24h: {overview['payments']['by_status']}")

    failures = []
    if run["status"] != "ok":
        failures.append("reconciliation mismatch")
    if replay_mismatches:
        failures.append("idempotent replay differed")
    if receiver.bad_signature:
        failures.append("webhook signature failed verification")
    print("\nRESULT:", "FAIL - " + ", ".join(failures) if failures else "PASS")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
