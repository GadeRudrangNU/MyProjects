import asyncio
import time
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .fleet import Fleet


class FaultRequest(BaseModel):
    device_id: int
    type: str
    severity: float = 1.0
    start_at: float | None = None
    duration_s: float = 30.0
    campaign_id: str | None = None


def _ts(epoch: float) -> datetime:
    return datetime.fromtimestamp(epoch, tz=UTC)


def create_app(fleet: Fleet, db_url: str | None = None) -> FastAPI:
    app = FastAPI(title="VoltBench Lab API")
    faults_spec = fleet.catalog["faults"]
    log: list[dict] = []

    row_ids: dict[int, int] = {}

    def write_row(entry: dict) -> int:
        import psycopg

        with psycopg.connect(db_url, autocommit=True) as conn:
            return conn.execute(
                "INSERT INTO lab.fault_injections (campaign_id, device_id, type, severity, start_at, end_at)"
                " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    entry["campaign_id"],
                    entry["device_id"],
                    entry["type"],
                    entry["severity"],
                    _ts(entry["start_at"]),
                    _ts(entry["end_at"]),
                ),
            ).fetchone()[0]

    def close_rows(pairs: list[tuple[int, float]]):
        import psycopg

        with psycopg.connect(db_url, autocommit=True) as conn:
            for row_id, end in pairs:
                conn.execute("UPDATE lab.fault_injections SET end_at = %s WHERE id = %s", (_ts(end), row_id))

    async def record(entry: dict):
        log.append(entry)
        if db_url:
            row_ids[entry["id"]] = await asyncio.to_thread(write_row, entry)

    @app.get("/devices")
    def devices():
        return fleet.manifest()

    @app.get("/fault-types")
    def fault_types():
        return faults_spec

    @app.post("/faults")
    async def inject(req: FaultRequest):
        dev = fleet.devices.get(req.device_id)
        if dev is None:
            raise HTTPException(404, "unknown device")
        spec = faults_spec.get(req.type)
        if spec is None:
            raise HTTPException(422, f"unknown fault type {req.type}")
        if dev.dtype not in spec["applies"]:
            raise HTTPException(422, f"{req.type} does not apply to {dev.dtype}")
        start = req.start_at if req.start_at else time.time()
        end = start + req.duration_s
        fault = fleet.add_fault(req.device_id, req.type, req.severity, start, end)
        entry = {
            "id": fault.id,
            "campaign_id": req.campaign_id,
            "device_id": req.device_id,
            "type": req.type,
            "severity": req.severity,
            "start_at": start,
            "end_at": end,
        }
        await record(entry)
        return entry

    @app.get("/faults")
    def active_faults():
        now = time.time()
        return [
            {"id": f.id, "device_id": d.dev_id, "type": f.type, "severity": f.severity, "start_at": f.start, "end_at": f.end}
            for d in fleet.devices.values()
            for f in d.faults
            if f.end > now
        ]

    @app.delete("/faults")
    async def clear(device_id: int | None = None):
        now = time.time()
        cleared = fleet.clear_faults(device_id, now)
        if db_url:
            pairs = [(row_ids[i], now) for i in cleared if i in row_ids]
            if pairs:
                await asyncio.to_thread(close_rows, pairs)
        return {"cleared": len(cleared)}

    @app.get("/healthz")
    def health():
        return {"ok": True, "devices": len(fleet.devices)}

    return app
