from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth import client_of

from . import services
from .models import ReconciliationRun, Settlement


class ReconciliationRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReconciliationRun
        fields = [
            "id",
            "status",
            "accounts_checked",
            "transactions_checked",
            "mismatch_count",
            "findings",
            "started_at",
            "finished_at",
        ]


class SettlementSerializer(serializers.ModelSerializer):
    account_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Settlement
        fields = ["id", "account_id", "amount", "payment_count", "created_at"]


class SettlementRunSerializer(serializers.Serializer):
    delay_seconds = serializers.IntegerField(min_value=0, required=False, allow_null=True, default=None)


class ReconciliationRunListView(ListAPIView):
    serializer_class = ReconciliationRunSerializer

    def get_queryset(self):
        return ReconciliationRun.objects.filter(client=client_of(self.request))

    @extend_schema(request=None, responses=ReconciliationRunSerializer)
    def post(self, request):
        run = services.reconcile(client_of(request))
        return Response(ReconciliationRunSerializer(run).data, status=status.HTTP_201_CREATED)


class SettlementListView(ListAPIView):
    serializer_class = SettlementSerializer

    def get_queryset(self):
        return Settlement.objects.filter(client=client_of(self.request))


class SettlementRunView(APIView):
    @extend_schema(request=SettlementRunSerializer, responses=SettlementSerializer(many=True))
    def post(self, request):
        body = SettlementRunSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        settlements = services.run_settlement(client_of(request), body.validated_data["delay_seconds"])
        return Response(SettlementSerializer(settlements, many=True).data, status=status.HTTP_201_CREATED)
