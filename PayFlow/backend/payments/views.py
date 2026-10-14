from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.views import APIView

from core.auth import client_of
from core.idempotency import run_idempotent
from ledger.models import Account
from ledger.views import MAX_AMOUNT

from . import services
from .models import Payment, Refund

RISK_SIGNAL_COUNT = 28


class PaymentSerializer(serializers.ModelSerializer):
    payer_id = serializers.UUIDField(read_only=True)
    payee_id = serializers.UUIDField(read_only=True)
    fraud = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id",
            "status",
            "amount",
            "refunded_amount",
            "currency",
            "payer_id",
            "payee_id",
            "description",
            "device_id",
            "auto_capture",
            "failure_reason",
            "fraud_score",
            "fraud_decision",
            "fraud",
            "metadata",
            "created_at",
            "captured_at",
        ]

    def get_fraud(self, payment: Payment) -> dict | None:
        assessment = getattr(payment, "assessment", None)
        if assessment is None:
            return None
        return {
            "score": assessment.score,
            "decision": assessment.decision,
            "model_score": assessment.model_score,
            "amount_zscore": assessment.amount_zscore,
            "reasons": assessment.reasons,
        }


class PaymentCreateSerializer(serializers.Serializer):
    payer_id = serializers.UUIDField()
    payee_id = serializers.UUIDField()
    amount = serializers.IntegerField(min_value=1, max_value=MAX_AMOUNT, help_text="Minor units (cents)")
    description = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    device_id = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    ip_address = serializers.IPAddressField(required=False, allow_null=True, default=None)
    metadata = serializers.DictField(required=False, default=dict)
    capture = serializers.BooleanField(required=False, default=True)
    risk_signals = serializers.ListField(
        child=serializers.FloatField(),
        min_length=RISK_SIGNAL_COUNT,
        max_length=RISK_SIGNAL_COUNT,
        required=False,
        allow_null=True,
        default=None,
        help_text="Optional 28 anonymised behavioural components from an upstream signal provider.",
    )

    def validate_risk_signals(self, value):
        if value is not None and any(abs(x) > 1e6 or x != x for x in value):
            raise serializers.ValidationError("Signals must be finite numbers.")
        return value


class RefundCreateSerializer(serializers.Serializer):
    payment_id = serializers.UUIDField()
    amount = serializers.IntegerField(min_value=1, max_value=MAX_AMOUNT, required=False, allow_null=True)
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class RefundSerializer(serializers.ModelSerializer):
    payment_id = serializers.UUIDField(read_only=True)
    ledger_transaction_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Refund
        fields = ["id", "payment_id", "amount", "reason", "ledger_transaction_id", "created_at"]


def _account(client, account_id, label: str) -> Account:
    try:
        return Account.objects.get(id=account_id, client=client)
    except Account.DoesNotExist:
        raise ValidationError({label: "No such account."}) from None


def _payment_response(payment: Payment) -> tuple[int, dict]:
    payment = Payment.objects.select_related("assessment").get(id=payment.id)
    body = PaymentSerializer(payment).data
    if payment.status == Payment.Status.FAILED:
        return status.HTTP_402_PAYMENT_REQUIRED, body
    if payment.status == Payment.Status.PENDING:
        return status.HTTP_202_ACCEPTED, body  # held for manual fraud review
    return status.HTTP_201_CREATED, body


class PaymentListCreateView(ListAPIView):
    serializer_class = PaymentSerializer

    def get_queryset(self):
        queryset = Payment.objects.filter(client=client_of(self.request)).select_related("assessment")
        params = self.request.query_params
        for field in ("status", "payer_id", "payee_id", "fraud_decision"):
            if params.get(field):
                queryset = queryset.filter(**{field: params[field]})
        return queryset

    @extend_schema(request=PaymentCreateSerializer, responses=PaymentSerializer)
    def post(self, request):
        body = PaymentCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        client = client_of(request)
        payer = _account(client, data["payer_id"], "payer_id")
        payee = _account(client, data["payee_id"], "payee_id")

        def handler():
            payment = services.create_payment(
                client=client,
                payer=payer,
                payee=payee,
                amount=data["amount"],
                description=data["description"],
                device_id=data["device_id"],
                ip_address=data["ip_address"],
                metadata=data["metadata"],
                risk_signals=data["risk_signals"],
                capture=data["capture"],
            )
            return _payment_response(payment)

        return run_idempotent(request, client, "payments.create", request.data, handler)


class PaymentDetailView(RetrieveAPIView):
    serializer_class = PaymentSerializer

    def get_queryset(self):
        return Payment.objects.filter(client=client_of(self.request)).select_related("assessment")


class _PaymentActionView(APIView):
    action_name = ""

    def run(self, client, payment_id):
        raise NotImplementedError

    @extend_schema(request=None, responses=PaymentSerializer)
    def post(self, request, pk):
        client = client_of(request)

        def handler():
            payment = self.run(client, pk)
            payment = Payment.objects.select_related("assessment").get(id=payment.id)
            return status.HTTP_200_OK, PaymentSerializer(payment).data

        return run_idempotent(request, client, f"payments.{self.action_name}:{pk}", {}, handler)


class PaymentCaptureView(_PaymentActionView):
    action_name = "capture"

    def run(self, client, payment_id):
        return services.capture_payment(client=client, payment_id=payment_id)


class PaymentVoidView(_PaymentActionView):
    action_name = "void"

    def run(self, client, payment_id):
        return services.void_payment(client=client, payment_id=payment_id)


class RefundListCreateView(ListAPIView):
    serializer_class = RefundSerializer

    def get_queryset(self):
        return Refund.objects.filter(payment__client=client_of(self.request))

    @extend_schema(request=RefundCreateSerializer, responses=RefundSerializer)
    def post(self, request):
        body = RefundCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        client = client_of(request)

        def handler():
            refund = services.refund_payment(
                client=client, payment_id=data["payment_id"], amount=data.get("amount"), reason=data["reason"]
            )
            return status.HTTP_201_CREATED, RefundSerializer(refund).data

        return run_idempotent(request, client, "refunds.create", request.data, handler)
