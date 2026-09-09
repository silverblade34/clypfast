"""SQLite Database configuration using SQLModel for ClipFinder."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path
from sqlmodel import Session, SQLModel, create_engine

DB_DIR = Path("outputs")
DB_PATH = DB_DIR / "clipfinder.db"

sqlite_url = f"sqlite:///{DB_PATH}"
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})


def init_db() -> None:
    """Initialize database tables."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    # Import models so SQLModel registers table schemas before creating all
    import clipfinder.models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    """FastAPI session dependency."""
    with Session(engine) as session:
        yield session
