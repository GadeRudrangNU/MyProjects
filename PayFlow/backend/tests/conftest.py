import copy

import pytest
from rest_framework.test import APIClient

from core.models import ApiClient
from ledger.models import Account
from ledger.services import deposit


@pytest.fixture
def no_fraud(settings):
    """Switch fraud rules and the model off, for tests about money movement alone."""
    cfg = copy.deepcopy(settings.PAYFLOW)
    cfg["FRAUD"].update(
        VELOCITY_REVIEW_COUNT=10**9,
        VELOCITY_BLOCK_COUNT=10**9,
        LARGE_AMOUNT_REVIEW=10**15,
        ZSCORE_REVIEW=10**9,
        NEW_DEVICE_AMOUNT_REVIEW=10**15,
        MODEL_ENABLED=False,
    )
    settings.PAYFLOW = cfg


@pytest.fixture
def tenant(db):
    client, key = ApiClient.create_with_key("Acme Marketplace")
    client.raw_key = key
    return client


def api_for(tenant: ApiClient) -> APIClient:
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {tenant.raw_key}")
    return api


@pytest.fixture
def api(tenant):
    return api_for(tenant)


@pytest.fixture
def world(tenant):
    """A funded customer and an empty merchant."""
    customer = Account.objects.create(client=tenant, name="Casey Customer", kind=Account.Kind.CUSTOMER)
    merchant = Account.objects.create(client=tenant, name="Bobs Books", kind=Account.Kind.MERCHANT)
    deposit(client=tenant, account=customer, amount=100_000)
    customer.refresh_from_db()
    return customer, merchant


_counter = {"n": 0}


def new_key() -> str:
    _counter["n"] += 1
    return f"test-key-{_counter['n']}"


def pay(api, customer, merchant, amount, key=None, **extra):
    return api.post(
        "/api/v1/payments",
        {"payer_id": str(customer.id), "payee_id": str(merchant.id), "amount": amount, **extra},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key or new_key(),
    )
