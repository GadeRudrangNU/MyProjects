"""Load test for the PayFlow API.

    PAYFLOW_API_KEY=pf_test_... locust -f loadtest/locustfile.py --host http://127.0.0.1:8000 \
        --headless -u 40 -r 10 -t 60s --csv loadtest/results/run

Each simulated user is a customer with their own funded account, paying at a human pace, so
the run measures the whole payment path (idempotency record, fraud scoring, row-locked ledger
transfer, webhook outbox) rather than one hot row. Business outcomes such as "insufficient
funds" are valid responses; only 5xx errors and unexpected status codes count as failures.

To measure raw throughput without the velocity rule flagging busy customers, start the API
with FRAUD_VELOCITY_REVIEW_COUNT / FRAUD_VELOCITY_BLOCK_COUNT raised.
"""

import os
import random
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
from locust import HttpUser, between, events, task

API_KEY = os.environ.get("PAYFLOW_API_KEY", "")
MERCHANTS: list[str] = []
FUNDS = 5_000_000  # $50,000 per customer: enough that insufficient funds is rare


WEBHOOK_PORT = int(os.environ.get("PAYFLOW_LOAD_WEBHOOK_PORT", "9098"))


class _Ok(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


@events.test_start.add_listener
def create_merchants(environment, **_):
    if not API_KEY:
        raise SystemExit("set PAYFLOW_API_KEY")
    # A webhook endpoint that always answers 200, so the outbox and delivery path is part of the load.
    server = ThreadingHTTPServer(("127.0.0.1", WEBHOOK_PORT), _Ok)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with httpx.Client(base_url=environment.host, headers={"Authorization": f"Bearer {API_KEY}"}, timeout=30) as http:
        http.put("/api/v1/webhooks/endpoint", json={"url": f"http://127.0.0.1:{WEBHOOK_PORT}/hook"}).raise_for_status()
        MERCHANTS.clear()
        for i in range(5):
            r = http.post("/api/v1/accounts", json={"name": f"Load merchant {i}-{uuid.uuid4().hex[:4]}", "kind": "merchant"})
            r.raise_for_status()
            MERCHANTS.append(r.json()["id"])


class Customer(HttpUser):
    wait_time = between(0.05, 0.4)

    def on_start(self):
        self.client.headers.update({"Authorization": f"Bearer {API_KEY}"})
        with self.client.post("/api/v1/accounts", json={"name": f"Load customer {uuid.uuid4().hex[:6]}", "kind": "customer"},
                              name="setup: create account", catch_response=True) as r:
            self.account = r.json()["id"]
        self.client.post(f"/api/v1/accounts/{self.account}/deposit", json={"amount": FUNDS},
                         headers={"Idempotency-Key": uuid.uuid4().hex}, name="setup: deposit")
        self.last_payment: str | None = None

    @task(10)
    def pay(self):
        body = {"payer_id": self.account, "payee_id": random.choice(MERCHANTS), "amount": random.choice([499, 1250, 2599, 4200, 9900, 15000])}
        key = uuid.uuid4().hex
        with self.client.post("/api/v1/payments", json=body, headers={"Idempotency-Key": key}, name="POST /payments", catch_response=True) as r:
            if r.status_code in (201, 202, 402):
                r.success()
                if r.status_code == 201:
                    self.last_payment = r.json()["id"]
            else:
                r.failure(f"unexpected {r.status_code}: {r.text[:120]}")
                return
        if random.random() < 0.05:  # a client retry after a timeout: must be answered from the stored response
            with self.client.post("/api/v1/payments", json=body, headers={"Idempotency-Key": key}, name="POST /payments (retry)", catch_response=True) as r:
                if r.status_code in (201, 202, 402) and r.headers.get("Idempotent-Replayed") == "true":
                    r.success()
                else:
                    r.failure(f"retry not replayed: {r.status_code}")

    @task(3)
    def balance(self):
        self.client.get(f"/api/v1/accounts/{self.account}/balance", name="GET /accounts/{id}/balance")

    @task(2)
    def history(self):
        self.client.get("/api/v1/transactions", params={"account": self.account, "limit": 20}, name="GET /transactions")

    @task(1)
    def refund(self):
        if self.last_payment:
            payment, self.last_payment = self.last_payment, None
            with self.client.post("/api/v1/refunds", json={"payment_id": payment, "amount": 100},
                                  headers={"Idempotency-Key": uuid.uuid4().hex}, name="POST /refunds", catch_response=True) as r:
                if r.status_code in (201, 402, 409, 422):
                    r.success()
                else:
                    r.failure(f"unexpected {r.status_code}")
