import json
import sqlite3
import threading
import time
from pathlib import Path


class RunStore:
    """Keeps one row per run key so the same incident revision never runs twice."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self.db.execute(
            """CREATE TABLE IF NOT EXISTS runs (
                run_key TEXT PRIMARY KEY, incident_sys_id TEXT NOT NULL, mod_count INTEGER NOT NULL,
                status TEXT NOT NULL, result TEXT, error TEXT, created REAL NOT NULL, finished REAL, request TEXT)"""
        )
        cols = [r[1] for r in self.db.execute("PRAGMA table_info(runs)")]
        if "request" not in cols:
            self.db.execute("ALTER TABLE runs ADD COLUMN request TEXT")
        self.db.commit()

    def claim(self, run_key: str, incident_sys_id: str, mod_count: int, request: dict | None = None) -> bool:
        with self.lock:
            try:
                self.db.execute(
                    "INSERT INTO runs (run_key, incident_sys_id, mod_count, status, created, request) VALUES (?,?,?,?,?,?)",
                    (run_key, incident_sys_id, mod_count, "queued", time.time(), json.dumps(request) if request else None),
                )
                self.db.commit()
                return True
            except sqlite3.IntegrityError:
                return False

    def release(self, run_key: str):
        with self.lock:
            self.db.execute("DELETE FROM runs WHERE run_key = ?", (run_key,))
            self.db.commit()

    def mark(self, run_key: str, status: str, result: dict | None = None, error: str | None = None):
        with self.lock:
            self.db.execute(
                "UPDATE runs SET status=?, result=?, error=?, finished=? WHERE run_key=?",
                (status, json.dumps(result) if result else None, error, time.time(), run_key),
            )
            self.db.commit()

    def get(self, run_key: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT run_key, incident_sys_id, mod_count, status, result, error FROM runs WHERE run_key=?", (run_key,)).fetchone()
        if not row:
            return None
        return {"run_key": row[0], "incident_sys_id": row[1], "mod_count": row[2], "status": row[3], "result": json.loads(row[4]) if row[4] else None, "error": row[5]}

    def unfinished(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT run_key, request FROM runs WHERE status IN ('queued','running')").fetchall()
        return [{"run_key": k, "request": json.loads(r) if r else None} for k, r in rows]
