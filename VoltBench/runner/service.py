import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import FastAPI, Request
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

from .dsl import parse_yaml
from .executor import Outcome, applicable, run_with_retry
from .gateway import GatewayClient, InfraError

log = logging.getLogger("runner")
PARALLEL_DEVICES = 20
CATALOG = Path(os.environ.get("VOLTBENCH_CATALOG") or Path(__file__).resolve().parent.parent / "spec" / "catalog.json")


class JsonFormatter(logging.Formatter):
    def format(self, record):
        out = {"ts": self.formatTime(record), "level": record.levelname, "svc": "runner", "msg": record.getMessage()}
        for key in ("run_id", "device_id", "test"):
            if hasattr(record, key):
                out[key] = getattr(record, key)
        return json.dumps(out)


class RunRequest(BaseModel):
    run_id: int


class Runner:
    def __init__(self, pg_url: str, gateway_url: str):
        self.pool = ConnectionPool(pg_url, min_size=1, max_size=8, open=False, kwargs={"autocommit": True})
        self.gw = GatewayClient(gateway_url)
        self.catalog = json.loads(CATALOG.read_text())
        self.tasks: set[asyncio.Task] = set()

    async def open(self):
        await asyncio.to_thread(self.pool.open)

    async def close(self):
        await asyncio.to_thread(self.pool.close)
        await self.gw.close()

    def start(self, run_id: int):
        task = asyncio.create_task(self.execute(run_id))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    def _fetch_sync(self, sql: str, args: tuple):
        with self.pool.connection() as conn:
            return conn.execute(sql, args).fetchall()

    def _exec_sync(self, sql: str, args: tuple):
        with self.pool.connection() as conn:
            conn.execute(sql, args)

    async def _fetch(self, sql: str, *args):
        return await asyncio.to_thread(self._fetch_sync, sql, args)

    async def _exec(self, sql: str, *args):
        await asyncio.to_thread(self._exec_sync, sql, args)

    async def execute(self, run_id: int):
        extra = {"run_id": run_id}
        try:
            (run,) = await self._fetch("SELECT plan_id, device_ids FROM test_runs WHERE id = %s", run_id)
            plan_id, device_ids = run
            defs = await self._fetch(
                "SELECT d.id, d.spec_yaml FROM test_plan_items i JOIN test_definitions d ON d.id = i.test_definition_id"
                " WHERE i.plan_id = %s ORDER BY i.ordinal",
                plan_id,
            )
            devices = await self._fetch(
                "SELECT id, serial, type, expected_firmware FROM devices WHERE id = ANY(%s) ORDER BY id", device_ids
            )
            specs = []
            for def_id, text in defs:
                spec, errors = parse_yaml(text)
                if spec is None:
                    raise ValueError(f"stored definition {def_id} is invalid: {errors}")
                specs.append((def_id, spec))
            await self._exec("UPDATE test_runs SET status='running', started_at=now() WHERE id=%s", run_id)
            log.info(f"run started on {len(devices)} devices", extra=extra)
            sem = asyncio.Semaphore(PARALLEL_DEVICES)

            async def per_device(row):
                dev = {"id": row[0], "serial": row[1], "type": row[2], "expected_firmware": row[3]}
                async with sem:
                    for def_id, spec in specs:
                        if not applicable(spec.device_type, dev["type"]):
                            continue
                        await self._run_one(run_id, dev, def_id, spec)

            await asyncio.gather(*(per_device(r) for r in devices))
            await self._exec("UPDATE test_runs SET status='completed', finished_at=now() WHERE id=%s", run_id)
            log.info("run completed", extra=extra)
        except Exception:
            log.exception("run failed", extra=extra)
            await self._exec("UPDATE test_runs SET status='failed', finished_at=now() WHERE id=%s", run_id)

    async def _run_one(self, run_id: int, dev: dict, def_id: int, spec):
        try:
            outcome = await run_with_retry(self.gw, dev, spec, self.catalog)
        except InfraError as e:
            outcome = Outcome("ERROR", message=str(e))
        log.info(f"{spec.name} {outcome.verdict}", extra={"run_id": run_id, "device_id": dev["id"], "test": spec.name})
        await self._exec(
            "INSERT INTO test_results (run_id, device_id, test_definition_id, verdict, attempt, measured, limits, steps, message, started_at, ended_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            run_id, dev["id"], def_id, outcome.verdict, outcome.attempt, Jsonb(outcome.measured),
            Jsonb(outcome.limits), Jsonb(outcome.steps), outcome.message, outcome.started_at, outcome.ended_at,
        )


def create_app(pg_url: str, gateway_url: str) -> FastAPI:
    runner = Runner(pg_url, gateway_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await runner.open()
        yield
        await runner.close()

    app = FastAPI(title="VoltBench Runner", lifespan=lifespan)

    @app.post("/validate")
    async def validate(request: Request):
        text = (await request.body()).decode("utf-8", errors="replace")
        spec, errors = parse_yaml(text)
        if spec is None:
            return {"ok": False, "errors": errors}
        return {"ok": True, "errors": [], "name": spec.name, "kind": spec.kind, "device_type": spec.device_type, "version": spec.version}

    @app.post("/runs", status_code=202)
    async def runs(req: RunRequest):
        runner.start(req.run_id)
        return {"accepted": req.run_id}

    @app.get("/healthz")
    async def health():
        return {"ok": True}

    return app


def seed(pg_url: str, library: Path):
    import psycopg

    with psycopg.connect(pg_url, autocommit=True) as conn:
        ids = {}
        for path in sorted(library.glob("*.yaml")):
            if path.name.startswith("plan_"):
                continue
            text = path.read_text()
            spec, errors = parse_yaml(text)
            if spec is None:
                raise SystemExit(f"{path.name}: {errors}")
            conn.execute(
                "INSERT INTO test_definitions (name, kind, device_type, version, spec_yaml) VALUES (%s,%s,%s,%s,%s)"
                " ON CONFLICT (name, version) DO NOTHING",
                (spec.name, spec.kind, spec.device_type, spec.version, text),
            )
            ids[spec.name] = conn.execute(
                "SELECT id FROM test_definitions WHERE name=%s AND version=%s", (spec.name, spec.version)
            ).fetchone()[0]
        for path in sorted(library.glob("plan_*.yaml")):
            plan = yaml.safe_load(path.read_text())
            conn.execute("INSERT INTO test_plans (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", (plan["name"],))
            plan_id = conn.execute("SELECT id FROM test_plans WHERE name=%s", (plan["name"],)).fetchone()[0]
            conn.execute("DELETE FROM test_plan_items WHERE plan_id=%s", (plan_id,))
            for ordinal, name in enumerate(plan["tests"]):
                conn.execute(
                    "INSERT INTO test_plan_items (plan_id, test_definition_id, ordinal) VALUES (%s,%s,%s)",
                    (plan_id, ids[name], ordinal),
                )
        print(f"seeded {len(ids)} test definitions")
