from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from core.auth import client_of
from core.idempotency import run_idempotent

from .models import Account, Entry, LedgerTransaction
from .services import deposit, derived_balance

MAX_AMOUNT = 10**12  # 10 billion in major units; keeps values inside BIGINT with room to spare


class AccountSerializer(serializers.ModelSerializer):
    balance = serializers.IntegerField(source="cached_balance", read_only=True)

    class Meta:
        model = Account
        fields = ["id", "name", "kind", "currency", "balance", "created_at"]
        read_only_fields = ["id", "balance", "created_at"]

    def validate_kind(self, value):
        if value not in {Account.Kind.CUSTOMER, Account.Kind.MERCHANT}:
            raise serializers.ValidationError("Only customer and merchant accounts can be created.")
        return value


class EntrySerializer(serializers.ModelSerializer):
    account_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Entry
        fields = ["id", "account_id", "amount", "created_at"]


class LedgerTransactionSerializer(serializers.ModelSerializer):
    entries = EntrySerializer(many=True, read_only=True)

    class Meta:
        model = LedgerTransaction
        fields = ["id", "kind", "reference", "memo", "created_at", "entries"]


class AmountSerializer(serializers.Serializer):
    amount = serializers.IntegerField(min_value=1, max_value=MAX_AMOUNT, help_text="Minor units (cents)")


class BalanceSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    currency = serializers.CharField()
    balance = serializers.IntegerField(help_text="Sum of the account's ledger entries, in minor units")


class AccountViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin, GenericViewSet):
    serializer_class = AccountSerializer

    def get_queryset(self):
        queryset = Account.objects.filter(client=client_of(self.request)).order_by("kind", "name", "created_at")
        kind = self.request.query_params.get("kind")
        return queryset.filter(kind=kind) if kind else queryset

    def perform_create(self, serializer):
        serializer.save(client=client_of(self.request))

    @extend_schema(responses=BalanceSerializer)
    @action(detail=True, methods=["get"])
    def balance(self, request, pk=None):
        account = self.get_object()
        return Response(
            {"account_id": account.id, "currency": account.currency, "balance": derived_balance(account.id)}
        )

    @extend_schema(responses=EntrySerializer(many=True))
    @action(detail=True, methods=["get"])
    def entries(self, request, pk=None):
        account = self.get_object()
        page = self.paginate_queryset(Entry.objects.filter(account=account).order_by("-id"))
        return self.get_paginated_response(EntrySerializer(page, many=True).data)

    @extend_schema(request=AmountSerializer, responses=AccountSerializer)
    @action(detail=True, methods=["post"])
    def deposit(self, request, pk=None):
        account = self.get_object()
        if account.kind not in {Account.Kind.CUSTOMER, Account.Kind.MERCHANT}:
            raise NotFound()
        body = AmountSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        client = client_of(request)

        def handler():
            txn = deposit(client=client, account=account, amount=body.validated_data["amount"])
            account.refresh_from_db()
            return status.HTTP_201_CREATED, {
                **AccountSerializer(account).data,
                "ledger_transaction_id": str(txn.id),
            }

        return run_idempotent(request, client, f"deposit:{account.id}", body.validated_data, handler)


class TransactionListView(ListAPIView):
    serializer_class = LedgerTransactionSerializer

    def get_queryset(self):
        queryset = LedgerTransaction.objects.filter(client=client_of(self.request)).prefetch_related("entries")
        params = self.request.query_params
        if params.get("account"):
            queryset = queryset.filter(entries__account_id=params["account"]).distinct()
        if params.get("kind"):
            queryset = queryset.filter(kind=params["kind"])
        if params.get("reference"):
            queryset = queryset.filter(reference=params["reference"])
        return queryset.order_by("-created_at", "-id")
