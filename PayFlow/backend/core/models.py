import hashlib
import secrets
import uuid

from django.db import models


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class ApiClient(models.Model):
    """A tenant (merchant platform). Every account, payment and webhook belongs to one."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    key_prefix = models.CharField(max_length=16, db_index=True)
    key_hash = models.CharField(max_length=64, unique=True)
    webhook_url = models.URLField(max_length=500, blank=True)
    webhook_secret = models.CharField(max_length=80, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name

    @classmethod
    def create_with_key(cls, name: str) -> tuple["ApiClient", str]:
        raw = "pf_test_" + secrets.token_urlsafe(24)
        client = cls.objects.create(
            name=name,
            key_prefix=raw[:12],
            key_hash=hash_api_key(raw),
            webhook_secret="whsec_" + secrets.token_urlsafe(24),
        )
        from ledger.services import ensure_system_accounts

        ensure_system_accounts(client)
        return client, raw


class IdempotencyRecord(models.Model):
    """One row per (client, Idempotency-Key). The unique constraint is what serialises
    concurrent duplicates: the second INSERT blocks until the first transaction ends."""

    client = models.ForeignKey(ApiClient, on_delete=models.CASCADE)
    key = models.CharField(max_length=255)
    endpoint = models.CharField(max_length=120)
    request_hash = models.CharField(max_length=64)
    response_status = models.PositiveSmallIntegerField(null=True)
    response_body = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["client", "key"], name="uniq_idempotency_client_key")]
