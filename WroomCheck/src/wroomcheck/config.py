"""Runtime settings (environment variables, optionally loaded from a .env file)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

EMBED_DIM = 384  # both embedders emit 384-d vectors so the pgvector schema is fixed


def _load_dotenv(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


@dataclass
class Settings:
    database_url: str
    embedder: str  # "minilm" | "hashing"
    llm: str  # "ollama" | "none"
    ollama_model: str
    ollama_url: str


def get_settings() -> Settings:
    _load_dotenv()
    env = os.environ.get
    return Settings(
        database_url=env("DATABASE_URL", "postgresql://wroom:wroom@localhost:5433/wroomcheck"),
        embedder=env("WROOM_EMBEDDER", "minilm"),
        llm=env("WROOM_LLM", "none"),
        ollama_model=env("OLLAMA_MODEL", "llama3.2:3b"),
        ollama_url=env("OLLAMA_URL", "http://localhost:11434"),
    )
