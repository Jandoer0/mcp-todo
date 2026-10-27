"""Authentication endpoints: register and login."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import (
    create_access_token,
    get_current_user,
    get_password_hash,
    dummy_password_hash,
    verify_password,
)
from ..config import settings
from ..db import get_db
from ..models import User
from ..security import attempt_allowed, reset_attempts
from ..site_settings import get_bool, get_int
from ..services import server_stats

router = APIRouter(prefix="/auth", tags=["auth"])

# Defaults for the brute-force guard; the live values are DB settings
# (admin panel → Server), see site_settings.DEFAULTS.
LOGIN_MAX_ATTEMPTS = 10
LOGIN_WINDOW_SEC = 300
REGISTER_MAX_PER_IP = 30
REGISTER_WINDOW_SEC = 3600


@router.get("/me")
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lightweight profile for the header's user dropdown.
    Also carries a couple of public policy values the UI needs (board cap,
    password hint) so the frontend has no hard-coded duplicates."""
    from ..board import MAX_BOARDS_PER_USER

    return {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
        "webhooks_enabled": bool(current_user.webhooks_enabled),
        "language": current_user.language or "ru",
        "date_format": current_user.date_format or "eu",
        "first_day_of_week": current_user.first_day_of_week or "monday",
        "max_boards": get_int(db, "max_boards_per_user", MAX_BOARDS_PER_USER),
        "password_min_length": get_int(db, "password_min_length", 6),
    }


@router.put("/profile", response_model=schemas.UserResponse)
def update_profile(
    data: schemas.ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Локализация и региональные настройки текущего пользователя.
    Значения приходят с фронтенда как ключи (см. schemas.DateFormat),
    поэтому присланный мусор отсекается валидацией Pydantic до записи."""
    payload = data.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=422, detail="Нечего обновлять")

    old_lang = current_user.language or "ru"
    for field, value in payload.items():
        setattr(current_user, field, value)
    db.commit()

    # При смене языка переименовываем системный «Регулярные» во всех досках
    # пользователя (ТЗ «Многоязычность»). Остальные списки не трогаем.
    new_lang = current_user.language or "ru"
    if new_lang != old_lang:
        from ..board import rename_regular_lists

        rename_regular_lists(db, current_user.id, old_lang, new_lang)

    db.refresh(current_user)
    return current_user


@router.get("/registration-status")
def registration_status(db: Session = Depends(get_db)):
    """Public flag so the login screen can hide the register option.
    Also carries the current password policy for the register hint."""
    return {
        "enabled": get_bool(db, "allow_registration", True),
        "password_min_length": get_int(db, "password_min_length", 6),
    }


@router.post("/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, request: Request, db: Session = Depends(get_db)):
    user.username = (user.username or "").strip()
    ip = request.client.host if request.client else "unknown"
    # 0 in the setting turns the cap off entirely.
    reg_cap = get_int(db, "register_rate_limit_per_hour", REGISTER_MAX_PER_IP)
    if reg_cap > 0 and not attempt_allowed(
        f"register:{ip}", reg_cap, REGISTER_WINDOW_SEC
    ):
        raise HTTPException(
            status_code=429, detail="Слишком много попыток регистрации. Попробуйте позже."
        )
    if not get_bool(db, "allow_registration", True):
        raise HTTPException(
            status_code=403, detail="Регистрация новых пользователей отключена"
        )
    if len(user.username) < 3:
        raise HTTPException(status_code=422, detail="Имя пользователя от 3 символов")
    min_pw = get_int(db, "password_min_length", 6)
    if len(user.password) < min_pw:
        raise HTTPException(status_code=422, detail=f"Пароль от {min_pw} символов")
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")
    if server_stats.db_size_exceeded(db):
        raise HTTPException(status_code=403, detail=server_stats.quota_error_message())
    db_user = User(
        username=user.username,
        hashed_password=get_password_hash(user.password),
        # Role is NEVER taken from the payload: a self-registered account is
        # always a regular user (otherwise anyone could POST role="admin").
        role="user",
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    # Lists are per-user: give the newcomer their protected default lists.
    from ..board import ensure_default_board, ensure_default_lists

    board = ensure_default_board(db, db_user.id)
    ensure_default_lists(db, db_user.id, board.id, language=db_user.language)
    # Базовый набор валют (RUB/USD/EUR) для мультивалютного бюджета.
    from ..services.currency_service import ensure_default_currencies

    ensure_default_currencies(db, db_user.id)
    return db_user


@router.post("/login", response_model=schemas.Token)
def login(user: schemas.UserCreate, db: Session = Depends(get_db)):
    user.username = (user.username or "").strip()
    limit_key = f"login:{user.username.lower()}"
    rate_on = get_bool(db, "login_rate_limit", True)
    if rate_on and not attempt_allowed(
        limit_key,
        get_int(db, "login_max_attempts", LOGIN_MAX_ATTEMPTS),
        get_int(db, "login_window_sec", LOGIN_WINDOW_SEC),
    ):
        raise HTTPException(
            status_code=429, detail="Слишком много попыток входа. Попробуйте позже."
        )
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user is None:
        # Timing-safe path: still run a hash comparison so a missing user
        # answers in the same time as a wrong password.
        verify_password(user.password or "", dummy_password_hash())
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    if not verify_password(user.password or "", db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    reset_attempts(limit_key)  # successful login clears the counter
    expire_min = get_int(
        db, "session_expire_minutes", settings["ACCESS_TOKEN_EXPIRE_MINUTES"]
    )
    token = create_access_token(
        data={"sub": db_user.username},
        expires_delta=timedelta(minutes=expire_min),
    )
    return {"access_token": token, "token_type": "bearer"}
