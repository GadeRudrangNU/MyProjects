"""Embeds every ticket (train and test, tagged by split) into the vector store for similarity search."""

import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agent"))
from triagepilot.config import Settings  # noqa: E402
from triagepilot.embeddings import get_embedder  # noqa: E402
from triagepilot.vectorstore import get_store  # noqa: E402


def main():
    s = Settings()
    df = pd.concat([pd.read_csv(ROOT / "data" / "processed" / f"{n}.csv") for n in ("train", "test")], ignore_index=True)
    embedder = get_embedder(s)
    store = get_store(s, embedder.dim)
    t = time.time()
    vecs = embedder.encode(df["text"].tolist())
    rows = [{"ref": r.ticket_id, "text": r.text[:400], "category": r.category, "split": r.split} for r in df.itertuples()]
    store.replace("ticket", rows, vecs)
    print(f"indexed {len(rows)} tickets in {time.time() - t:.0f}s with {s.vector_backend}")


if __name__ == "__main__":
    main()
