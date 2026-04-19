import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = BASE_DIR / "uploads"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'app.db'}")

SECRET_KEY = os.getenv("SESSION_SECRET", "dev-change-me-in-production-use-long-random-string")
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "25"))
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
