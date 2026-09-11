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

    # Safe migration: add columns to video table if missing
    try:
        with engine.connect() as conn:
            cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(video)").fetchall()]
            if "channel" not in cols:
                conn.exec_driver_sql("ALTER TABLE video ADD COLUMN channel VARCHAR")
            if "provider" not in cols:
                conn.exec_driver_sql("ALTER TABLE video ADD COLUMN provider VARCHAR")
            if "llm_model" not in cols:
                conn.exec_driver_sql("ALTER TABLE video ADD COLUMN llm_model VARCHAR")
            conn.commit()
    except Exception:
        pass

    # Safe migration: add Stage 2 social content columns to clip table if missing
    _CLIP_MIGRATIONS = [
        ("core_idea", "VARCHAR"),
        ("surface_topic", "VARCHAR"),
        ("hidden_angle", "VARCHAR"),
        ("hook", "VARCHAR"),
        ("quote", "VARCHAR"),
        ("social_description", "VARCHAR"),
        ("engagement_question", "VARCHAR"),
        ("alternative_hooks", "VARCHAR"),  # JSON-encoded list
        ("social_score", "INTEGER"),
        ("stage2_done", "BOOLEAN DEFAULT 0"),
    ]
    try:
        with engine.connect() as conn:
            clip_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(clip)").fetchall()]
            for col_name, col_type in _CLIP_MIGRATIONS:
                if col_name not in clip_cols:
                    conn.exec_driver_sql(f"ALTER TABLE clip ADD COLUMN {col_name} {col_type}")
            conn.commit()
    except Exception:
        pass



def get_session() -> Generator[Session, None, None]:
    """FastAPI session dependency."""
    with Session(engine) as session:
        yield session
