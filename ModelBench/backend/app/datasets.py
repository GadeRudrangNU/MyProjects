import csv
import io
import re
from pathlib import Path

from .config import DATA_DIR, UPLOAD_DIR

SAMPLE = "sample_sentiment"
_SAFE = re.compile(r"[^a-zA-Z0-9_-]")


def _path(name: str) -> Path | None:
    if name == SAMPLE:
        return DATA_DIR / "sample_sentiment.csv"
    p = UPLOAD_DIR / f"{_SAFE.sub('', name)}.csv"
    return p if p.exists() else None


def parse_csv(raw: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames or {"text", "label"} - set(reader.fieldnames):
        raise ValueError("CSV needs 'text' and 'label' columns")
    rows = [{"text": r["text"].strip(), "label": r["label"].strip().lower()} for r in reader if r["text"].strip()]
    if not rows:
        raise ValueError("CSV has no rows")
    return rows


def load_dataset(name: str) -> list[dict]:
    path = _path(name)
    if path is None:
        raise FileNotFoundError(f"Unknown dataset '{name}'")
    return parse_csv(path.read_text(encoding="utf-8"))


def list_datasets() -> list[dict]:
    names = [SAMPLE]
    if UPLOAD_DIR.exists():
        names += sorted(p.stem for p in UPLOAD_DIR.glob("*.csv"))
    return [{"name": n, "n_samples": len(load_dataset(n))} for n in names]


def save_upload(name: str, raw: str) -> dict:
    rows = parse_csv(raw)
    safe = _SAFE.sub("", name.removesuffix(".csv"))
    if not safe or safe == SAMPLE:
        raise ValueError("Invalid dataset name")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / f"{safe}.csv").write_text(raw, encoding="utf-8")
    return {"name": safe, "n_samples": len(rows)}
