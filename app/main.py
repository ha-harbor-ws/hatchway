from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from app.config import ALLOWED_EXTENSIONS, MAX_UPLOAD_MB, SECRET_KEY, UPLOADS_DIR
from app.database import get_db, init_db
from app.exif_utils import get_gps_coords
from app.models import User, WellSubmission

app = FastAPI(title="Hatchway")
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, session_cookie="hatchway_session")


@app.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    """Проверка живости за прокси / Docker healthcheck (без БД)."""
    return {"status": "ok"}


BASE_DIR = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(UPLOADS_DIR)), name="media")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.on_event("startup")
def _startup() -> None:
    init_db()


def _norm_tab(tab: str) -> str:
    return re.sub(r"\s+", "", tab or "")


def _norm_surname(s: str) -> str:
    return (s or "").strip().casefold()


def current_user_id(request: Request) -> int | None:
    uid = request.session.get("user_id")
    return int(uid) if uid is not None else None


def require_user(request: Request, db: Session) -> User:
    uid = current_user_id(request)
    if uid is None:
        raise HTTPException(status_code=401, detail="Требуется вход")
    user = db.get(User, uid)
    if user is None:
        request.session.clear()
        raise HTTPException(status_code=401, detail="Сессия недействительна")
    return user


MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024


async def _read_upload(upload: UploadFile) -> tuple[bytes, str]:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Недопустимое расширение: {suffix or 'нет'}")
    data = await upload.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"Файл больше {MAX_UPLOAD_MB} МБ")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Пустой файл")
    return data, suffix


@app.get("/", response_class=HTMLResponse)
def root(request: Request, db: Session = Depends(get_db)) -> HTMLResponse:
    uid = current_user_id(request)
    if uid is None:
        return RedirectResponse("/login", status_code=302)
    user = db.get(User, uid)
    if user is None:
        request.session.clear()
        return RedirectResponse("/login", status_code=302)
    rows = _rating_rows(db)
    return templates.TemplateResponse(
        "dashboard.html",
        {"request": request, "user": user, "rating": rows, "show_user": True},
    )


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request) -> HTMLResponse:
    if current_user_id(request) is not None:
        return RedirectResponse("/", status_code=302)
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@app.post("/login", response_class=HTMLResponse)
def login_post(
    request: Request,
    tab_number: str = Form(...),
    surname: str = Form(...),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    tab = _norm_tab(tab_number)
    if not tab.isdigit():
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Табельный номер — только цифры"},
            status_code=400,
        )
    sn = _norm_surname(surname)
    if not sn:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Укажите фамилию"},
            status_code=400,
        )
    user = None
    for u in db.scalars(select(User).where(User.tab_number == tab)):
        if _norm_surname(u.surname) == sn:
            user = u
            break
    if user is None:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Неверный табельный номер или фамилия"},
            status_code=401,
        )
    request.session["user_id"] = user.id
    return RedirectResponse("/", status_code=302)


@app.get("/register", response_class=HTMLResponse)
def register_page(request: Request) -> HTMLResponse:
    if current_user_id(request) is not None:
        return RedirectResponse("/", status_code=302)
    return templates.TemplateResponse("register.html", {"request": request, "error": None})


@app.post("/register", response_class=HTMLResponse)
def register_post(
    request: Request,
    tab_number: str = Form(...),
    surname: str = Form(...),
    first_name: str = Form(...),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    tab = _norm_tab(tab_number)
    if not tab.isdigit():
        return templates.TemplateResponse(
            "register.html",
            {"request": request, "error": "Табельный номер — только цифры"},
            status_code=400,
        )
    fn = (first_name or "").strip()
    sn = (surname or "").strip()
    if not fn or not sn:
        return templates.TemplateResponse(
            "register.html",
            {"request": request, "error": "Укажите имя и фамилию"},
            status_code=400,
        )
    exists = db.scalar(select(User).where(User.tab_number == tab))
    if exists:
        return templates.TemplateResponse(
            "register.html",
            {"request": request, "error": "Пользователь с таким табельным номером уже есть"},
            status_code=400,
        )
    user = User(tab_number=tab, surname=sn, first_name=fn)
    db.add(user)
    db.commit()
    db.refresh(user)
    request.session["user_id"] = user.id
    return RedirectResponse("/", status_code=302)


@app.post("/logout")
def logout(request: Request) -> RedirectResponse:
    request.session.clear()
    return RedirectResponse("/login", status_code=302)


def _rating_rows(db: Session) -> list[dict]:
    q = (
        select(User.first_name, User.surname, func.count(WellSubmission.id).label("wells"))
        .outerjoin(WellSubmission, WellSubmission.user_id == User.id)
        .group_by(User.id, User.first_name, User.surname)
        .order_by(func.count(WellSubmission.id).desc(), User.surname, User.first_name)
    )
    rows = db.execute(q).all()
    return [{"first_name": r[0], "surname": r[1], "hatch_photos": int(r[2])} for r in rows]


@app.post("/api/well", response_class=HTMLResponse)
async def upload_well(
    request: Request,
    hatch: UploadFile = File(...),
    panorama: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    user = require_user(request, db)

    hatch_data, hatch_ext = await _read_upload(hatch)
    pan_data, pan_ext = await _read_upload(panorama)

    ok_h, lat_h, lon_h = get_gps_coords(hatch_data)
    ok_p, _, _ = get_gps_coords(pan_data)
    if not ok_h:
        raise HTTPException(status_code=400, detail="В фото люка нет геоданных EXIF (GPS)")
    if not ok_p:
        raise HTTPException(status_code=400, detail="В панорамном фото нет геоданных EXIF (GPS)")

    uid_folder = UPLOADS_DIR / str(user.id)
    uid_folder.mkdir(parents=True, exist_ok=True)
    pair_id = uuid.uuid4().hex
    hatch_name = f"{pair_id}_hatch{hatch_ext}"
    pan_name = f"{pair_id}_panorama{pan_ext}"
    hatch_path = uid_folder / hatch_name
    pan_path = uid_folder / pan_name

    with hatch_path.open("wb") as f:
        f.write(hatch_data)
    with pan_path.open("wb") as f:
        f.write(pan_data)

    rel_h = f"{user.id}/{hatch_name}"
    rel_p = f"{user.id}/{pan_name}"

    sub = WellSubmission(
        user_id=user.id,
        hatch_rel_path=rel_h,
        panorama_rel_path=rel_p,
        hatch_lat=float(lat_h),
        hatch_lon=float(lon_h),
    )
    db.add(sub)
    db.commit()

    rows = _rating_rows(db)
    return templates.TemplateResponse(
        "partials/rating_table.html",
        {"request": request, "rating": rows, "ok": True},
    )


@app.get("/api/rating", response_class=HTMLResponse)
def api_rating(request: Request, db: Session = Depends(get_db)) -> HTMLResponse:
    require_user(request, db)
    rows = _rating_rows(db)
    return templates.TemplateResponse("partials/rating_table.html", {"request": request, "rating": rows})
