from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from .. import bq
from ..config import ROOT, ClientConfig, Settings

API_URL = "https://datamanager.googleapis.com/v1/audienceMembers:ingest"
API_SCOPE = "https://www.googleapis.com/auth/datamanager"
MAX_MEMBERS_PER_REQUEST = 10_000
MAX_IDENTIFIERS_PER_MEMBER = 10
_HEX64 = re.compile(r"^[0-9a-f]{64}$")

LOG_COLUMNS = [
    "run_id",
    "run_at",
    "segment_name",
    "mode",
    "request_no",
    "members",
    "status",
    "request_id",
    "error",
    "payload_path",
]


def _clean(value: Any) -> Any:
    return None if value is None or (not isinstance(value, str) and pd.isna(value)) else value


def member_from_row(row: dict) -> dict | None:
    identifiers = []
    if _clean(row.get("hashed_email")):
        identifiers.append({"emailAddress": row["hashed_email"]})
    if _clean(row.get("hashed_phone")):
        identifiers.append({"phoneNumber": row["hashed_phone"]})
    address = {
        "givenName": _clean(row.get("hashed_first_name")),
        "familyName": _clean(row.get("hashed_last_name")),
        "regionCode": _clean(row.get("region_code")),
        "postalCode": _clean(row.get("postal_code")),
    }
    if all(address.values()):
        identifiers.append({"address": address})
    if not identifiers:
        return None
    return {"userData": {"userIdentifiers": identifiers}}


def build_destination(segment: str, user_list_id: str | None) -> dict:
    operating = (os.environ.get("GOOGLE_ADS_CUSTOMER_ID") or "DRY_RUN_ACCOUNT").replace("-", "")
    login = (os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") or "").replace("-", "")
    destination: dict[str, Any] = {
        "operatingAccount": {"accountType": "GOOGLE_ADS", "accountId": operating},
        "productDestinationId": user_list_id or f"DRY_RUN_LIST_{segment}",
    }
    if login:
        destination["loginAccount"] = {"accountType": "GOOGLE_ADS", "accountId": login}
    return destination


def build_requests(
    segment: str,
    rows: Iterable[dict],
    user_list_id: str | None = None,
    validate_only: bool = False,
    chunk_size: int = MAX_MEMBERS_PER_REQUEST,
) -> list[dict]:
    members = [m for m in (member_from_row(r) for r in rows) if m]
    destination = build_destination(segment, user_list_id)
    requests = []
    for start in range(0, len(members), chunk_size):
        requests.append(
            {
                "destinations": [destination],
                "audienceMembers": members[start : start + chunk_size],
                "consent": {"adUserData": "CONSENT_GRANTED", "adPersonalization": "CONSENT_GRANTED"},
                "encoding": "HEX",
                "validateOnly": validate_only,
            }
        )
    return requests


def validate_request(request: dict) -> list[str]:
    errors = []
    members = request.get("audienceMembers", [])
    if not request.get("destinations"):
        errors.append("missing destinations")
    if not members:
        errors.append("no audience members")
    if len(members) > MAX_MEMBERS_PER_REQUEST:
        errors.append(f"{len(members)} members exceeds the {MAX_MEMBERS_PER_REQUEST} per-request limit")
    consent = request.get("consent", {})
    if consent.get("adUserData") != "CONSENT_GRANTED" or consent.get("adPersonalization") != "CONSENT_GRANTED":
        errors.append("consent signals are not both CONSENT_GRANTED")
    for i, member in enumerate(members):
        identifiers = member.get("userData", {}).get("userIdentifiers", [])
        if not identifiers:
            errors.append(f"member {i}: no identifiers")
        if len(identifiers) > MAX_IDENTIFIERS_PER_MEMBER:
            errors.append(f"member {i}: too many identifiers")
        for ident in identifiers:
            for key, value in ident.items():
                if key == "address":
                    for part in ("givenName", "familyName"):
                        if not _HEX64.match(value.get(part, "")):
                            errors.append(f"member {i}: address.{part} is not a SHA-256 hex digest")
                elif not _HEX64.match(str(value)):
                    errors.append(f"member {i}: {key} is not a SHA-256 hex digest")
        if len(errors) >= 20:
            errors.append("... further errors suppressed")
            break
    return errors


def _send(request: dict) -> tuple[str, str | None, str | None]:
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    credentials, _ = google.auth.default(scopes=[API_SCOPE])
    response = AuthorizedSession(credentials).post(API_URL, json=request, timeout=120)
    if response.status_code != 200:
        return "error", None, f"{response.status_code}: {response.text[:500]}"
    return "sent", response.json().get("requestId"), None


def run(
    client,
    settings: Settings,
    cfg: ClientConfig,
    live: bool = False,
    validate_only: bool = False,
    out_dir: Path | None = None,
) -> list[dict]:
    out_dir = out_dir or ROOT / "activation_payloads"
    out_dir.mkdir(parents=True, exist_ok=True)
    mode = "live" if live and not validate_only else "validate_only" if live else "dry_run"
    run_id, now = uuid.uuid4().hex[:12], datetime.now(timezone.utc)

    summary = bq.query_df(client, f"SELECT * FROM `{bq.table_id(settings, 'activation', 'audience_summary')}`")
    ready = bq.query_df(client, f"SELECT * FROM `{bq.table_id(settings, 'activation', 'activation_ready')}`")
    list_ids = (cfg.activation or {}).get("user_lists", {}) or {}

    log, report = [], []
    for item in summary.sort_values("segment_name").to_dict("records"):
        segment = item["segment_name"]
        entry = {"segment": segment, "activatable": int(item["activatable_size"]), "status": "skipped"}
        if not item["meets_min"]:
            entry["reason"] = f"below minimum audience size ({cfg.min_audience_size})"
            report.append(entry)
            continue
        if live and not list_ids.get(segment):
            entry.update(status="skipped", reason="no user list id configured for live upload")
            report.append(entry)
            continue

        rows = ready[ready["segment_name"] == segment].to_dict("records")
        requests = build_requests(segment, rows, list_ids.get(segment), validate_only=validate_only)
        status = "ok"
        for number, request in enumerate(requests, start=1):
            errors = validate_request(request)
            path = out_dir / f"{segment}_{number:03d}.json"
            path.write_text(json.dumps({"request": request}, indent=1), encoding="utf-8")
            request_id, error = None, "; ".join(errors) or None
            if errors:
                row_status = "invalid"
            elif live:
                row_status, request_id, error = _send(request)
            else:
                row_status = "dry_run_ok"
            if row_status in ("invalid", "error"):
                status = row_status
            log.append(
                dict(
                    run_id=run_id,
                    run_at=now,
                    segment_name=segment,
                    mode=mode,
                    request_no=number,
                    members=len(request["audienceMembers"]),
                    status=row_status,
                    request_id=request_id,
                    error=error,
                    payload_path=str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
                )
            )
        entry.update(status=status, requests=len(requests), mode=mode)
        report.append(entry)

    if log:
        frame = pd.DataFrame(log, columns=LOG_COLUMNS)
        from google.cloud import bigquery

        kinds = {"run_at": "TIMESTAMP", "request_no": "INT64", "members": "INT64"}
        schema = [bigquery.SchemaField(c, kinds.get(c, "STRING")) for c in LOG_COLUMNS]
        table = bq.table_id(settings, "activation", "activation_log")
        client.create_table(bigquery.Table(table, schema=schema), exists_ok=True)
        bq.load_df(client, frame, table, append=True, schema=schema)

    (ROOT / "reports").mkdir(exist_ok=True)
    (ROOT / "reports" / "activation_summary.json").write_text(
        json.dumps({"run_id": run_id, "mode": mode, "segments": report}, indent=1, default=str), encoding="utf-8"
    )
    return report
