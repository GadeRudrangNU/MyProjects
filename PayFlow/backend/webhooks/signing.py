"""Webhook signatures. Header format: ``PayFlow-Signature: t=<unix>,v1=<hex hmac-sha256>`` where
the MAC covers ``"<t>." + raw body``. Receivers should reject timestamps older than a few
minutes (replay protection) and compare MACs in constant time."""

import hashlib
import hmac
import time

SIGNATURE_HEADER = "PayFlow-Signature"


def compute_signature(secret: str, timestamp: int, body: bytes) -> str:
    return hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def signature_header(secret: str, body: bytes, timestamp: int | None = None) -> str:
    ts = int(time.time()) if timestamp is None else timestamp
    return f"t={ts},v1={compute_signature(secret, ts, body)}"


def verify_signature(
    secret: str, header: str, body: bytes, tolerance_seconds: int = 300, now: float | None = None
) -> bool:
    try:
        parts = dict(item.split("=", 1) for item in header.split(","))
        timestamp = int(parts["t"])
        provided = parts["v1"]
    except (KeyError, ValueError):
        return False
    current = time.time() if now is None else now
    if abs(current - timestamp) > tolerance_seconds:
        return False
    return hmac.compare_digest(provided, compute_signature(secret, timestamp, body))
