from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, db
from .api import router
from .models import MLModel
from .observability import setup_observability

DEFAULT_MODELS = [
    {"name": "distilbert-sst2", "hf_id": "distilbert-base-uncased-finetuned-sst-2-english",
     "description": "DistilBERT fine-tuned on SST-2 (66M params)"},
    {"name": "distilbert-imdb", "hf_id": "lvwerra/distilbert-imdb",
     "description": "DistilBERT fine-tuned on IMDB reviews"},
    {"name": "keyword-baseline", "hf_id": "keyword:baseline",
     "description": "Zero-ML keyword counter; the floor every real model should beat"},
]


def seed_defaults() -> None:
    session = db.SessionLocal()
    try:
        if session.query(MLModel).count() == 0:
            session.add_all(MLModel(**m) for m in DEFAULT_MODELS)
            session.commit()
    finally:
        session.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    db.configure(config.DATABASE_URL)
    if config.SEED_DEFAULTS:
        seed_defaults()
    yield


app = FastAPI(title="ModelBench", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
setup_observability(app)
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
