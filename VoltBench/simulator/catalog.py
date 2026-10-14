import json
import os
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "spec" / "catalog.json"


def load(path: str | None = None) -> dict:
    with open(path or os.environ.get("VOLTBENCH_CATALOG") or DEFAULT_PATH) as f:
        return json.load(f)
