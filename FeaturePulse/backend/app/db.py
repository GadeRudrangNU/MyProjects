from __future__ import annotations

from functools import lru_cache

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from backend.app import config
from backend.app.models import Base


@lru_cache(maxsize=1)
def get_engine():
    engine = create_engine(config.get_database_url(), pool_pre_ping=True)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    return engine


def init_schema(engine=None) -> None:
    Base.metadata.create_all(engine or get_engine())


def session_factory(engine=None) -> sessionmaker:
    return sessionmaker(bind=engine or get_engine(), expire_on_commit=False)


def get_session():
    """FastAPI dependency."""
    s = session_factory()()
    try:
        yield s
    finally:
        s.close()


def sync_url_for_langchain(engine) -> str:
    return engine.url.render_as_string(hide_password=False)
