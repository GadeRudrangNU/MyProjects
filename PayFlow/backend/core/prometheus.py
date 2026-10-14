"""Business metrics. Request rate and latency come from django-prometheus; counters that
only the API process increments live here, and state that any process can change (webhook
deliveries, review queue, reconciliation) is read from the database at scrape time so the
numbers are right even with several gunicorn workers and Celery workers."""

from prometheus_client import CollectorRegistry, Counter
from prometheus_client.core import GaugeMetricFamily

IDEMPOTENT_REPLAYS = Counter("payflow_idempotent_replays_total", "Requests answered from a stored idempotent response")
PAYMENTS_CREATED = Counter(
    "payflow_payments_created_total", "Payments processed by the API", ["status", "fraud_decision"]
)
LEDGER_POSTINGS = Counter("payflow_ledger_postings_total", "Balanced ledger transactions posted", ["kind"])
INSUFFICIENT_FUNDS = Counter(
    "payflow_insufficient_funds_total", "Transfers rejected because they would overdraw an account"
)


class DatabaseCollector:
    def collect(self):
        from django.db.models import Count

        from backoffice.models import ReconciliationRun
        from fraud.models import ReviewItem
        from payments.models import Payment
        from webhooks.models import WebhookDelivery

        by_status = GaugeMetricFamily("payflow_payments", "Payments by status", labels=["status"])
        for row in Payment.objects.values("status").annotate(n=Count("id")):
            by_status.add_metric([row["status"]], row["n"])
        yield by_status

        decisions = GaugeMetricFamily("payflow_fraud_decisions", "Payments by fraud decision", labels=["decision"])
        for row in Payment.objects.exclude(fraud_decision="").values("fraud_decision").annotate(n=Count("id")):
            decisions.add_metric([row["fraud_decision"]], row["n"])
        yield decisions

        hooks = GaugeMetricFamily("payflow_webhook_deliveries", "Webhook deliveries by status", labels=["status"])
        for row in WebhookDelivery.objects.values("status").annotate(n=Count("id")):
            hooks.add_metric([row["status"]], row["n"])
        yield hooks

        open_reviews = GaugeMetricFamily("payflow_review_queue_open", "Payments awaiting fraud review")
        open_reviews.add_metric([], ReviewItem.objects.filter(status=ReviewItem.Status.OPEN).count())
        yield open_reviews

        last = ReconciliationRun.objects.order_by("-started_at").first()
        ok = GaugeMetricFamily("payflow_reconciliation_ok", "1 if the last reconciliation run was clean")
        ok.add_metric([], 0 if last is None or last.status != ReconciliationRun.Status.OK else 1)
        yield ok
        mismatches = GaugeMetricFamily(
            "payflow_reconciliation_mismatches", "Problems found by the last reconciliation run"
        )
        mismatches.add_metric([], last.mismatch_count if last else 0)
        yield mismatches


def database_registry() -> CollectorRegistry:
    registry = CollectorRegistry()
    registry.register(DatabaseCollector())
    return registry
