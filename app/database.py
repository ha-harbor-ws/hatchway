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


def _rename_well_submissions_to_hatches_sqlite() -> None:
    """Старая таблица well_submissions → hatches."""
    if not str(DATABASE_URL).startswith("sqlite"):
        return
    insp = inspect(engine)
    if insp.has_table("well_submissions") and not insp.has_table("hatches"):
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE well_submissions RENAME TO hatches"))


def _migrate_sqlite_hatch_columns() -> None:
    """Добавить недостающие столбцы к hatches (после переименования или старых БД)."""
    if not str(DATABASE_URL).startswith("sqlite"):
        return
    insp = inspect(engine)
    if not insp.has_table("hatches"):
        return
    existing = {c["name"] for c in insp.get_columns("hatches")}
    alters: list[str] = []
    if "panorama_lat" not in existing:
        alters.append("ALTER TABLE hatches ADD COLUMN panorama_lat REAL")
    if "panorama_lon" not in existing:
        alters.append("ALTER TABLE hatches ADD COLUMN panorama_lon REAL")
    if "user_map_lat" not in existing:
        alters.append("ALTER TABLE hatches ADD COLUMN user_map_lat REAL")
    if "user_map_lon" not in existing:
        alters.append("ALTER TABLE hatches ADD COLUMN user_map_lon REAL")
    if "user_map_accuracy_m" not in existing:
        alters.append("ALTER TABLE hatches ADD COLUMN user_map_accuracy_m REAL")
    if not alters:
        return
    with engine.begin() as conn:
        for sql in alters:
            conn.execute(text(sql))


def init_db() -> None:
    from app import models  # noqa: F401

    _rename_well_submissions_to_hatches_sqlite()
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite_hatch_columns()
