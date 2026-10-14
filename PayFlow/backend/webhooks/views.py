from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth import client_of

from . import services
from .models import WebhookDelivery
from .signing import SIGNATURE_HEADER


class DeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = WebhookDelivery
        fields = [
            "id",
            "event_type",
            "status",
            "attempts",
            "next_attempt_at",
            "last_status_code",
            "last_error",
            "created_at",
            "delivered_at",
            "payload",
        ]


class EndpointSerializer(serializers.Serializer):
    url = serializers.URLField(allow_blank=True, max_length=500)


class EndpointView(APIView):
    def _describe(self, client):
        return {"url": client.webhook_url, "secret": client.webhook_secret, "signature_header": SIGNATURE_HEADER}

    @extend_schema(responses=dict)
    def get(self, request):
        return Response(self._describe(client_of(request)))

    @extend_schema(request=EndpointSerializer, responses=dict)
    def put(self, request):
        body = EndpointSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        url = body.validated_data["url"]
        if url:
            try:
                services.assert_deliverable_url(url)
            except services.UnsafeWebhookURL as exc:
                raise ValidationError({"url": str(exc)}) from exc
        client = client_of(request)
        client.webhook_url = url
        client.save(update_fields=["webhook_url"])
        return Response(self._describe(client))


class DeliveryListView(ListAPIView):
    serializer_class = DeliverySerializer

    def get_queryset(self):
        queryset = WebhookDelivery.objects.filter(client=client_of(self.request))
        wanted = self.request.query_params.get("status")
        return queryset.filter(status=wanted) if wanted else queryset


class DeliveryRetryView(APIView):
    @extend_schema(request=None, responses=DeliverySerializer)
    def post(self, request, pk):
        try:
            delivery = WebhookDelivery.objects.get(id=pk, client=client_of(request))
        except WebhookDelivery.DoesNotExist:
            raise NotFound() from None
        delivery.status = WebhookDelivery.Status.PENDING
        delivery.attempts = 0
        delivery.next_attempt_at = delivery.enqueued_at = timezone.now()
        delivery.save(update_fields=["status", "attempts", "next_attempt_at", "enqueued_at"])
        services.enqueue(delivery.id)
        delivery.refresh_from_db()
        return Response(DeliverySerializer(delivery).data)
