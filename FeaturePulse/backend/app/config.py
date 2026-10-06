"""Runtime settings. DATABASE_URL points at any PostgreSQL that has the pgvector extension
(docker-compose.yml provides one). If it is unset, a self-contained local Postgres+pgvector is
started from the `pgserver` package under data/pgdata so the project runs with zero setup."""
from __future__ import annotations

import os
from pathlib import Path

from ml import config as ml_config

ROOT = ml_config.ROOT
LOCAL_PG_DIR = Path(os.getenv("FEATUREPULSE_PGDATA", ROOT / "data" / "pgdata"))
COLLECTION_NAME = "feedback_embeddings"


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_dotenv()


def _normalize(url: str) -> str:
    """SQLAlchemy needs the psycopg (v3) driver, which langchain-postgres also uses."""
    for prefix in ("postgresql://", "postgres://", "postgresql+psycopg2://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if url:
        return _normalize(url)
    import pgserver  # embedded Postgres 16 + pgvector, no Docker needed

    server = pgserver.get_server(LOCAL_PG_DIR, cleanup_mode=None)  # keep running between launches
    return _normalize(server.get_uri())
