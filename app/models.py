from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("tab_number", name="uq_users_tab_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tab_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    surname: Mapped[str] = mapped_column(String(128), nullable=False)
    first_name: Mapped[str] = mapped_column(String(128), nullable=False)

    wells: Mapped[list["WellSubmission"]] = relationship(back_populates="user")


class WellSubmission(Base):
    """Один колодец = пара фото (люк + панорама)."""

    __tablename__ = "well_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    hatch_rel_path: Mapped[str] = mapped_column(String(512), nullable=False)
    panorama_rel_path: Mapped[str] = mapped_column(String(512), nullable=False)
    # EXIF GPS с фото люка
    hatch_lat: Mapped[float] = mapped_column(Float, nullable=False)
    hatch_lon: Mapped[float] = mapped_column(Float, nullable=False)
    # EXIF GPS с панорамы (nullable для старых строк после миграции)
    panorama_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    panorama_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Геопозиция пользователя с карты (браузер), при отказе — NULL
    user_map_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    user_map_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    user_map_accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped["User"] = relationship(back_populates="wells")
