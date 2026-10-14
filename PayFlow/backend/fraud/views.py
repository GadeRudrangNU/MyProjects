from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from core.auth import client_of
from payments.models import Payment
from payments.services import resolve_review
from payments.views import PaymentSerializer

from .model import load_model
from .models import ReviewItem


class ReviewItemSerializer(serializers.ModelSerializer):
    payment = serializers.SerializerMethodField()

    class Meta:
        model = ReviewItem
        fields = ["id", "status", "note", "created_at", "resolved_at", "payment"]

    def get_payment(self, item: ReviewItem) -> dict:
        return PaymentSerializer(item.payment).data


class ResolveSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approve", "reject"])
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class ReviewQueueView(ListAPIView):
    """Payments held for manual review, riskiest first. `?status=` accepts open (default), approved, rejected."""

    serializer_class = ReviewItemSerializer

    def get_queryset(self):
        wanted = self.request.query_params.get("status", ReviewItem.Status.OPEN)
        return (
            ReviewItem.objects.filter(payment__client=client_of(self.request), status=wanted)
            .select_related("payment", "payment__assessment")
            .order_by("-payment__fraud_score", "created_at")
        )


class ReviewResolveView(APIView):
    @extend_schema(request=ResolveSerializer, responses=PaymentSerializer)
    def post(self, request, payment_id):
        body = ResolveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        payment = resolve_review(
            client=client_of(request),
            payment_id=payment_id,
            approve=body.validated_data["decision"] == "approve",
            note=body.validated_data["note"],
        )
        payment = Payment.objects.select_related("assessment").get(id=payment.id)
        return Response(PaymentSerializer(payment).data, status=status.HTTP_200_OK)


class ModelInfoView(APIView):
    """Describes the deployed fraud model and its held-out evaluation."""

    @extend_schema(responses=dict)
    def get(self, request):
        model = load_model()
        if model is None:
            return Response({"loaded": False})
        return Response(
            {
                "loaded": True,
                "review_threshold": model.review_threshold,
                "block_threshold": model.block_threshold,
                "metrics": model.metrics,
            }
        )
