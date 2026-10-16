"""Splits the raw ticket CSV into a stratified 80/20 train/test pair with stable ids."""

import sys
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agent"))
from triagepilot.schemas import CATEGORIES  # noqa: E402

RAW = ROOT / "data" / "raw" / "all_tickets_processed_improved_v3.csv"
OUT = ROOT / "data" / "processed"


def main():
    df = pd.read_csv(RAW).rename(columns={"Document": "text", "Topic_group": "category"})
    df["text"] = df["text"].astype(str).str.strip()
    df = df[df["text"].str.len() > 0].drop_duplicates("text").reset_index(drop=True)
    assert set(df["category"]) == set(CATEGORIES), set(df["category"])
    df.insert(0, "ticket_id", [f"T{i:05d}" for i in range(len(df))])
    train, test = train_test_split(df, test_size=0.2, stratify=df["category"], random_state=42)
    OUT.mkdir(parents=True, exist_ok=True)
    train.assign(split="train").to_csv(OUT / "train.csv", index=False)
    test.assign(split="test").to_csv(OUT / "test.csv", index=False)
    history = train.sample(3000, random_state=5).rename(columns={"text": "document", "category": "topic_group"})
    history[["ticket_id", "document", "topic_group"]].to_csv(OUT / "import_history.csv", index=False)
    print(f"train={len(train)} test={len(test)} history={len(history)}")
    print(test["category"].value_counts().to_string())


if __name__ == "__main__":
    main()
