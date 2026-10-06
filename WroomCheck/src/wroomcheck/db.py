"""Postgres + pgvector storage."""
from __future__ import annotations

import json
from importlib import resources
from typing import Iterable, Iterator, Sequence

import numpy as np
import psycopg
from pgvector.psycopg import register_vector
from psycopg.types.json import Jsonb

from .models import Campaign, Complaint

_COLS = "id, make, model, year, component, comp_cat, date_received, fail_date, crash, fire, injured, deaths"


def connect(url: str) -> psycopg.Connection:
    conn = psycopg.connect(url, connect_timeout=5)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    conn.commit()
    register_vector(conn)
    return conn


def init_schema(conn: psycopg.Connection) -> None:
    conn.execute(resources.files("wroomcheck").joinpath("schema.sql").read_text(encoding="utf-8"))
    conn.commit()


def insert_complaints(conn: psycopg.Connection, items: Iterable[Complaint]) -> int:
    """Bulk load with COPY into a staging table, then upsert (re-running ingest is safe)."""
    with conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE stage (LIKE complaints INCLUDING DEFAULTS) ON COMMIT DROP")
        with cur.copy(f"COPY stage ({_COLS}, text) FROM STDIN") as cp:
            for c in items:
                cp.write_row((c.id, c.make, c.model, c.year, c.component, c.comp_cat, c.date_received,
                              c.fail_date, c.crash, c.fire, c.injured, c.deaths, c.text))
        cur.execute(f"INSERT INTO complaints ({_COLS}, text) SELECT {_COLS}, text FROM stage ON CONFLICT DO NOTHING")
        n = cur.rowcount
    conn.commit()
    return n


def replace_campaigns(conn: psycopg.Connection, camps: Sequence[Campaign]) -> None:
    with conn.cursor() as cur:
        cur.execute("TRUNCATE campaigns")
        cur.executemany(
            "INSERT INTO campaigns VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            [(c.camp_no, c.make, c.model, list(c.years), list(c.comp_cats), c.report_date, c.component,
              c.description, c.consequence, c.remedy, c.potentially_affected) for c in camps],
        )
    conn.commit()


def load_campaigns(conn: psycopg.Connection) -> list[Campaign]:
    rows = conn.execute("SELECT camp_no, make, model, years, comp_cats, report_date, component, description, "
                        "consequence, remedy, potentially_affected FROM campaigns").fetchall()
    return [Campaign(r[0], r[1], r[2], tuple(r[3]), tuple(r[4]), r[5], r[6] or "", r[7] or "", r[8] or "",
                     r[9] or "", r[10] or 0) for r in rows]


def fetch_unembedded(conn: psycopg.Connection, limit: int) -> list[tuple[int, str]]:
    return conn.execute("SELECT id, text FROM complaints WHERE embedding IS NULL ORDER BY id LIMIT %s", (limit,)).fetchall()


def save_embeddings(conn: psycopg.Connection, ids: Sequence[int], vecs: np.ndarray) -> None:
    with conn.cursor() as cur:
        cur.executemany("UPDATE complaints SET embedding = %s WHERE id = %s", [(v, i) for i, v in zip(ids, vecs)])
    conn.commit()


def create_vector_index(conn: psycopg.Connection) -> None:
    conn.execute("CREATE INDEX IF NOT EXISTS complaints_emb_hnsw ON complaints USING hnsw (embedding vector_cosine_ops)")
    conn.commit()


def _complaint(row, text: str = "") -> Complaint:
    return Complaint(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], text, row[8], row[9], row[10], row[11])


def stream_for_detection(conn: psycopg.Connection) -> Iterator[tuple[Complaint, np.ndarray]]:
    """Server-side cursor in (make, model, comp_cat, date, id) order; texts are not loaded."""
    with conn.cursor(name="wroom_detect") as cur:
        cur.itersize = 5000
        cur.execute(f"SELECT {_COLS}, embedding FROM complaints WHERE embedding IS NOT NULL "
                    "ORDER BY make, model, comp_cat, date_received, id")
        for row in cur:
            yield _complaint(row), np.asarray(row[12], dtype=np.float32)


def fetch_complaints(conn: psycopg.Connection, ids: Sequence[int]) -> dict[int, Complaint]:
    rows = conn.execute(f"SELECT {_COLS}, text FROM complaints WHERE id = ANY(%s)", (list(ids),)).fetchall()
    return {r[0]: _complaint(r, r[12]) for r in rows}


def search(conn: psycopg.Connection, qvec: np.ndarray, make: str | None, model: str | None, k: int = 8) -> list[dict]:
    rows = conn.execute(
        f"SELECT {_COLS}, text, 1 - (embedding <=> %s) AS sim FROM complaints "
        "WHERE embedding IS NOT NULL AND (%s::text IS NULL OR make = %s) AND (%s::text IS NULL OR model = %s) "
        "ORDER BY embedding <=> %s LIMIT %s",
        (qvec, make, make, model, model, qvec, k),
    ).fetchall()
    return [{"complaint": _complaint(r, r[12]), "similarity": float(r[13])} for r in rows]


def save_snapshot(conn: psycopg.Connection, doc: dict) -> None:
    conn.execute("INSERT INTO snapshots (doc) VALUES (%s)", (Jsonb(doc),))
    conn.commit()


def load_snapshot(conn: psycopg.Connection) -> dict | None:
    row = conn.execute("SELECT doc FROM snapshots ORDER BY id DESC LIMIT 1").fetchone()
    return row[0] if row else None
