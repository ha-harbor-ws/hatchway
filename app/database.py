from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import DATA_DIR, DATABASE_URL


DATA_DIR.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_sqlite_well_columns() -> None:
    """Добавить столбцы к существующей SQLite-таблице без Alembic."""
    if not str(DATABASE_URL).startswith("sqlite"):
        return
    insp = inspect(engine)
    if not insp.has_table("well_submissions"):
        return
    existing = {c["name"] for c in insp.get_columns("well_submissions")}
    alters: list[str] = []
    if "panorama_lat" not in existing:
        alters.append("ALTER TABLE well_submissions ADD COLUMN panorama_lat REAL")
    if "panorama_lon" not in existing:
        alters.append("ALTER TABLE well_submissions ADD COLUMN panorama_lon REAL")
    if "user_map_lat" not in existing:
        alters.append("ALTER TABLE well_submissions ADD COLUMN user_map_lat REAL")
    if "user_map_lon" not in existing:
        alters.append("ALTER TABLE well_submissions ADD COLUMN user_map_lon REAL")
    if "user_map_accuracy_m" not in existing:
        alters.append("ALTER TABLE well_submissions ADD COLUMN user_map_accuracy_m REAL")
    if not alters:
        return
    with engine.begin() as conn:
        for sql in alters:
            conn.execute(text(sql))


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _migrate_sqlite_well_columns()
