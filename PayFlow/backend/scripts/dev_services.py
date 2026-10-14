"""Run PayFlow's backing services locally without Docker.

* PostgreSQL 16 via the ``pgserver`` wheel (a real Postgres, not an emulation)
* a Redis-compatible server via ``fakeredis`` (pure Python; the Compose stack uses real Redis)

Writes ``.dev-services.env`` (read by payflow/settings.py) and keeps running until Ctrl+C.
"""

import json
import os
import shutil
import signal
import sys
import threading
import time
from pathlib import Path

import pgserver
from fakeredis import TcpFakeServer

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / ".devdata" / "pg"
ENV_FILE = ROOT / ".dev-services.env"
REDIS_PORT = int(os.environ.get("DEV_REDIS_PORT", "6390"))
DB_NAME = "payflow"


def ensure_timezone_data() -> None:
    """The Windows pgserver build ships without time-zone data, so Postgres rejects
    ``SET TIME ZONE 'UTC'``. Borrow the compiled zoneinfo files from the ``tzdata`` package."""
    import tzdata

    target = Path(pgserver.__file__).parent / "pginstall" / "share" / "postgresql" / "timezone"
    if target.exists():
        return
    shutil.copytree(Path(tzdata.__file__).parent / "zoneinfo", target)


def main() -> None:
    ENV_FILE.unlink(missing_ok=True)
    ensure_timezone_data()
    DATA_DIR.parent.mkdir(parents=True, exist_ok=True)
    server = pgserver.get_server(DATA_DIR, cleanup_mode="stop")
    server.psql(f"SELECT 1 FROM pg_database WHERE datname = '{DB_NAME}'")
    exists = DB_NAME in server.psql("SELECT datname FROM pg_database;")
    if not exists:
        server.psql(f"CREATE DATABASE {DB_NAME};")
    uri = server.get_uri().rsplit("/", 1)[0] + f"/{DB_NAME}"

    redis_server = TcpFakeServer(("127.0.0.1", REDIS_PORT), server_type="redis")
    threading.Thread(target=redis_server.serve_forever, daemon=True).start()

    ENV_FILE.write_text(
        "\n".join(
            [
                "DJANGO_DEBUG=1",
                f"DATABASE_URL={uri}",
                f"CELERY_BROKER_URL=redis://127.0.0.1:{REDIS_PORT}/0",
                "WEBHOOK_BACKOFF_BASE_SECONDS=2",
                "WEBHOOK_SWEEP_SECONDS=5",
            ]
        )
        + "\n"
    )
    print(json.dumps({"database": uri, "redis_port": REDIS_PORT, "env_file": str(ENV_FILE)}), flush=True)
    print("dev services ready (Ctrl+C to stop)", flush=True)

    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    while not stop.is_set():
        time.sleep(0.5)
    redis_server.shutdown()
    server.cleanup()
    ENV_FILE.unlink(missing_ok=True)
    print("stopped", flush=True)


if __name__ == "__main__":
    sys.exit(main())
