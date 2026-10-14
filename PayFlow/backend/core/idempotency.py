"""Exactly-once execution of money-moving requests.

Protocol: the client sends ``Idempotency-Key``. The first request with a key runs the
handler and stores its response in the *same database transaction* as the side effects.
Any later request with the same key (retry, double click, concurrent duplicate) gets the
stored response back and runs nothing. Reusing a key with a different body is an error.
"""

import hashlib
import json
import time
from collections.abc import Callable
from typing import Any

from django.db import IntegrityError, OperationalError, transaction
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .errors import BusinessRuleViolation
from .models import IdempotencyRecord
from .prometheus import IDEMPOTENT_REPLAYS

HEADER = "Idempotency-Key"
MAX_KEY_LENGTH = 255
RETRYABLE_SQLSTATES = {"40P01", "40001"}  # deadlock_detected, serialization_failure
MAX_ATTEMPTS = 3

Handler = Callable[[], tuple[int, dict[str, Any]]]


def _fingerprint(scope: str, body: Any) -> str:
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(f"{scope}|{canonical}".encode()).hexdigest()


def run_idempotent(request, client, scope: str, body: Any, handler: Handler) -> Response:
    key = request.headers.get(HEADER, "").strip()
    if not key:
        raise ValidationError({HEADER: "This header is required for this endpoint."})
    if len(key) > MAX_KEY_LENGTH:
        raise ValidationError({HEADER: f"Must be at most {MAX_KEY_LENGTH} characters."})
    fingerprint = _fingerprint(scope, body)

    # A deadlock rolls the whole transaction back, including the idempotency record, so the
    # request can simply be run again. Lock ordering makes this rare; this makes it harmless.
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return _execute(client, key, scope, fingerprint, handler)
        except OperationalError as exc:
            if getattr(exc.__cause__, "sqlstate", None) not in RETRYABLE_SQLSTATES or attempt == MAX_ATTEMPTS:
                raise
            time.sleep(0.02 * attempt)
    raise AssertionError("unreachable")


def _execute(client, key: str, scope: str, fingerprint: str, handler: Handler) -> Response:
    with transaction.atomic():
        try:
            with transaction.atomic():  # savepoint, so a unique violation keeps the outer txn usable
                record = IdempotencyRecord.objects.create(
                    client=client, key=key, endpoint=scope, request_hash=fingerprint
                )
        except IntegrityError:
            # Another request owns this key. The INSERT only fails once that request has
            # committed, so the stored response is guaranteed to be visible here.
            existing = IdempotencyRecord.objects.get(client=client, key=key)
            if existing.request_hash != fingerprint:
                raise BusinessRuleViolation(
                    "Idempotency-Key was already used with a different request.",
                    code="idempotency_key_reuse",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                ) from None
            IDEMPOTENT_REPLAYS.inc()
            response = Response(existing.response_body, status=existing.response_status)
            response["Idempotent-Replayed"] = "true"
            return response

        status_code, payload = handler()
        record.response_status = status_code
        record.response_body = json.loads(json.dumps(payload, default=str))
        record.save(update_fields=["response_status", "response_body"])
    return Response(record.response_body, status=status_code)
