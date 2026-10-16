from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TP_", env_file=ROOT / ".env", extra="ignore")

    sn_url: str = "http://127.0.0.1:8070"
    sn_user: str = "svc_triagepilot"
    sn_password: str = "triage-local"
    api_token: str = "local-dev-token"

    ollama_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen2.5:7b"
    llm_temperature: float = 0.0
    llm_timeout: float = 120.0
    llm_mode: Literal["live", "record", "replay"] = "live"
    llm_cassette: Path = ROOT / "agent" / "tests" / "cassettes" / "llm.json"

    fast_path_threshold: float = 0.85
    kb_top_k: int = 3
    similar_top_k: int = 5
    duplicate_article_similarity: float = 0.85

    embedder: Literal["sbert", "hash"] = "sbert"
    embedding_model: str = "all-MiniLM-L6-v2"
    vector_backend: Literal["numpy", "pgvector"] = "numpy"
    database_url: str = "postgresql://triagepilot:triagepilot@127.0.0.1:5432/triagepilot"
    retrieval_exclude_splits: list[str] = []

    artifacts_dir: Path = ROOT / "artifacts"
    runtime_dir: Path = ROOT / "data" / "runtime"
    workers: int = 2

    @property
    def classifier_path(self) -> Path:
        return self.artifacts_dir / "classifier.joblib"

    @property
    def vectors_dir(self) -> Path:
        return self.artifacts_dir / "vectors"

    @property
    def runs_db(self) -> Path:
        return self.runtime_dir / "runs.sqlite"


def get_settings() -> Settings:
    return Settings()
