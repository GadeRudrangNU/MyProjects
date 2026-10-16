import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .config import Settings


@dataclass
class Hit:
    ref: str
    text: str
    category: str
    score: float
    meta: dict = field(default_factory=dict)


class NumpyStore:
    """Exact cosine search over vectors kept in memory and saved as .npy/.json per kind."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._vecs: dict[str, np.ndarray] = {}
        self._rows: dict[str, list[dict]] = {}

    def _load(self, kind: str):
        if kind in self._vecs:
            return
        vf, rf = self.root / f"{kind}.npy", self.root / f"{kind}.json"
        if vf.exists() and rf.exists():
            self._vecs[kind] = np.load(vf)
            self._rows[kind] = json.loads(rf.read_text(encoding="utf-8"))
        else:
            self._vecs[kind] = np.zeros((0, 1), dtype=np.float32)
            self._rows[kind] = []

    def _persist(self, kind: str):
        np.save(self.root / f"{kind}.npy", self._vecs[kind])
        (self.root / f"{kind}.json").write_text(json.dumps(self._rows[kind]), encoding="utf-8")

    def replace(self, kind: str, rows: list[dict], vectors: np.ndarray):
        self._vecs[kind] = vectors.astype(np.float32)
        self._rows[kind] = rows
        self._persist(kind)

    def add(self, kind: str, row: dict, vector: np.ndarray):
        self._load(kind)
        v = vector.reshape(1, -1).astype(np.float32)
        refs = [r["ref"] for r in self._rows[kind]]
        if row["ref"] in refs:
            i = refs.index(row["ref"])
            self._rows[kind][i] = row
            self._vecs[kind][i] = v[0]
        else:
            self._vecs[kind] = v if not self._rows[kind] else np.vstack([self._vecs[kind], v])
            self._rows[kind].append(row)
        self._persist(kind)

    def count(self, kind: str) -> int:
        self._load(kind)
        return len(self._rows[kind])

    def search(self, kind: str, vector: np.ndarray, k: int, exclude_splits: list[str] | None = None) -> list[Hit]:
        self._load(kind)
        rows = self._rows[kind]
        if not rows:
            return []
        scores = self._vecs[kind] @ vector.astype(np.float32)
        if exclude_splits:
            mask = np.array([r.get("split") in exclude_splits for r in rows])
            scores = np.where(mask, -2.0, scores)
        order = np.argsort(-scores)[:k]
        return [
            Hit(rows[i]["ref"], rows[i]["text"], rows[i].get("category", ""), float(scores[i]), rows[i].get("meta", {}))
            for i in order
            if scores[i] > -1.5
        ]


class PgVectorStore:
    """Same interface backed by PostgreSQL with the pgvector extension."""

    def __init__(self, url: str, dim: int = 384):
        import psycopg
        from pgvector.psycopg import register_vector

        self.dim = dim
        self.conn = psycopg.connect(url, autocommit=True)
        self.conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        register_vector(self.conn)
        self.conn.execute(
            f"""CREATE TABLE IF NOT EXISTS tp_vectors (
                id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, text TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '', split TEXT, meta JSONB NOT NULL DEFAULT '{{}}',
                embedding vector({dim}) NOT NULL, UNIQUE (kind, ref))"""
        )
        self.conn.execute("CREATE INDEX IF NOT EXISTS tp_vectors_hnsw ON tp_vectors USING hnsw (embedding vector_cosine_ops)")

    def replace(self, kind: str, rows: list[dict], vectors: np.ndarray):
        self.conn.execute("DELETE FROM tp_vectors WHERE kind = %s", (kind,))
        with self.conn.cursor() as cur:
            with cur.copy("COPY tp_vectors (kind, ref, text, category, split, meta, embedding) FROM STDIN") as cp:
                for r, v in zip(rows, vectors):
                    cp.write_row((kind, r["ref"], r["text"], r.get("category", ""), r.get("split"), json.dumps(r.get("meta", {})), v.tolist()))

    def add(self, kind: str, row: dict, vector: np.ndarray):
        self.conn.execute(
            """INSERT INTO tp_vectors (kind, ref, text, category, split, meta, embedding) VALUES (%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (kind, ref) DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding""",
            (kind, row["ref"], row["text"], row.get("category", ""), row.get("split"), json.dumps(row.get("meta", {})), vector.tolist()),
        )

    def count(self, kind: str) -> int:
        return self.conn.execute("SELECT count(*) FROM tp_vectors WHERE kind = %s", (kind,)).fetchone()[0]

    def search(self, kind: str, vector: np.ndarray, k: int, exclude_splits: list[str] | None = None) -> list[Hit]:
        rows = self.conn.execute(
            """SELECT ref, text, category, 1 - (embedding <=> %s::vector) AS score, meta FROM tp_vectors
               WHERE kind = %s AND (split IS NULL OR NOT (split = ANY(%s)))
               ORDER BY embedding <=> %s::vector LIMIT %s""",
            (vector.tolist(), kind, exclude_splits or [], vector.tolist(), k),
        ).fetchall()
        return [Hit(r[0], r[1], r[2], float(r[3]), r[4]) for r in rows]


def get_store(settings: Settings, dim: int = 384):
    if settings.vector_backend == "pgvector":
        return PgVectorStore(settings.database_url, dim)
    return NumpyStore(settings.vectors_dir)
