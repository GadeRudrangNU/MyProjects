from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

engine = None
SessionLocal = None


class Base(DeclarativeBase):
    pass


def configure(url: str) -> None:
    """(Re)bind the engine; in-memory SQLite shares one connection so tests see one DB."""
    global engine, SessionLocal
    kwargs: dict = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if url in ("sqlite://", "sqlite:///:memory:"):
            kwargs["poolclass"] = StaticPool
    engine = create_engine(url, **kwargs)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    from . import models  # noqa: F401  (register tables)

    Base.metadata.create_all(engine)


def get_db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
