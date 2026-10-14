from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMinute
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from backoffice.models import ReconciliationRun
from fraud.models import ReviewItem
from ledger.models import Account
from payments.models import Payment
from webhooks.models import WebhookDelivery

from .auth import client_of

SERIES_MINUTES = 30


class OverviewView(APIView):
    """Headline numbers and a per-minute series for the dashboard."""

    @extend_schema(responses=dict)
    def get(self, request):
        client = client_of(request)
        now = timezone.now()
        day = Payment.objects.filter(client=client, created_at__gte=now - timedelta(hours=24))

        by_status = {row["status"]: row["n"] for row in day.values("status").annotate(n=Count("id"))}
        total = sum(by_status.values())
        settled_states = [Payment.Status.AUTHORIZED, Payment.Status.CAPTURED, Payment.Status.REFUNDED]
        succeeded = sum(by_status.get(s, 0) for s in settled_states)
        flagged = day.filter(fraud_decision__in=["review", "block"]).count()
        volume = (
            day.filter(status__in=[Payment.Status.CAPTURED, Payment.Status.REFUNDED]).aggregate(v=Sum("amount"))["v"]
            or 0
        )
        refunded = day.aggregate(v=Sum("refunded_amount"))["v"] or 0

        since = (now - timedelta(minutes=SERIES_MINUTES)).replace(second=0, microsecond=0)
        buckets = {
            row["minute"]: row
            for row in Payment.objects.filter(client=client, created_at__gte=since)
            .annotate(minute=TruncMinute("created_at"))
            .values("minute")
            .annotate(
                count=Count("id"),
                volume=Sum("amount", filter=Q(status__in=[Payment.Status.CAPTURED, Payment.Status.REFUNDED])),
                flagged=Count("id", filter=Q(fraud_decision__in=["review", "block"])),
            )
        }
        series = []
        for i in range(SERIES_MINUTES + 1):
            minute = since + timedelta(minutes=i)
            row = buckets.get(minute, {})
            series.append(
                {
                    "minute": minute.isoformat(),
                    "count": row.get("count", 0),
                    "volume": row.get("volume") or 0,
                    "flagged": row.get("flagged", 0),
                }
            )

        last_run = ReconciliationRun.objects.filter(client=client).first()
        hooks = {
            row["status"]: row["n"]
            for row in WebhookDelivery.objects.filter(client=client).values("status").annotate(n=Count("id"))
        }
        return Response(
            {
                "window": "24h",
                "payments": {
                    "total": total,
                    "by_status": by_status,
                    "success_rate": round(succeeded / total, 4) if total else None,
                    "flagged": flagged,
                    "flag_rate": round(flagged / total, 4) if total else None,
                    "captured_volume": volume,
                    "refunded_volume": refunded,
                },
                "accounts": Account.objects.filter(client=client).count(),
                "open_reviews": ReviewItem.objects.filter(
                    payment__client=client, status=ReviewItem.Status.OPEN
                ).count(),
                "webhooks": hooks,
                "reconciliation": None
                if last_run is None
                else {
                    "status": last_run.status,
                    "mismatch_count": last_run.mismatch_count,
                    "finished_at": last_run.finished_at.isoformat(),
                },
                "series": series,
            }
        )


class MeView(APIView):
    @extend_schema(responses=dict)
    def get(self, request):
        client = client_of(request)
        return Response({"id": str(client.id), "name": client.name, "key_prefix": client.key_prefix})
