"""Settings read from the environment and .env"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


class Settings:

    @property
    def ai_provider(self) -> str:
        v = os.getenv("AI_PROVIDER", "local").strip().lower()
        return v if v in {"gemini", "local"} else "local"

    @property
    def gemini_api_key(self) -> str:
        return os.getenv("GEMINI_API_KEY", "").strip()

    @property
    def gemini_model(self) -> str:
        return os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()

    @property
    def ai_daily_limit(self) -> int:
        try:
            return int(os.getenv("AI_DAILY_REQUEST_LIMIT", "40"))
        except ValueError:
            return 40

    @property
    def database_url(self) -> str:
        url = os.getenv("DATABASE_URL")
        if url:
            return url
        (ROOT / "data").mkdir(exist_ok=True)
        return f"sqlite:///{(ROOT / 'data' / 'coopcompass.db').as_posix()}"

    @property
    def embedding_backend(self) -> str:
        return os.getenv("EMBEDDING_BACKEND", "auto").strip().lower()

    @property
    def embedding_model(self) -> str:
        return os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

    @property
    def demo_data(self) -> bool:
        return _bool("DEMO_DATA", False)

    @property
    def min_applications_for_rates(self) -> int:
        return int(os.getenv("MIN_APPLICATIONS_FOR_RATES", "5"))

    @property
    def time_claim_threshold(self) -> int:
        return int(os.getenv("TIME_CLAIM_THRESHOLD", "10"))

    @property
    def high_match_threshold(self) -> float:
        return float(os.getenv("HIGH_MATCH_THRESHOLD", "70"))


settings = Settings()
