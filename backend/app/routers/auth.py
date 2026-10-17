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
from ..site_settings import get_bool
from ..services import server_stats

router = APIRouter(prefix="/auth", tags=["auth"])

# Brute-force protection: per-username login attempts and per-IP signups.
LOGIN_MAX_ATTEMPTS = 10
LOGIN_WINDOW_SEC = 300
REGISTER_MAX_PER_IP = 30
REGISTER_WINDOW_SEC = 3600


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    """Lightweight profile for the header's user dropdown."""
    return {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
        "webhooks_enabled": bool(current_user.webhooks_enabled),
    }


@router.get("/registration-status")
def registration_status(db: Session = Depends(get_db)):
    """Public flag so the login screen can hide the register option."""
    return {"enabled": get_bool(db, "allow_registration", True)}


@router.post("/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, request: Request, db: Session = Depends(get_db)):
    user.username = (user.username or "").strip()
    ip = request.client.host if request.client else "unknown"
    if not attempt_allowed(f"register:{ip}", REGISTER_MAX_PER_IP, REGISTER_WINDOW_SEC):
        raise HTTPException(
            status_code=429, detail="Слишком много попыток регистрации. Попробуйте позже."
        )
    if not get_bool(db, "allow_registration", True):
        raise HTTPException(
            status_code=403, detail="Регистрация новых пользователей отключена"
        )
    if len(user.username) < 3:
        raise HTTPException(status_code=422, detail="Имя пользователя от 3 символов")
    if len(user.password) < 6:
        raise HTTPException(status_code=422, detail="Пароль от 6 символов")
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
    ensure_default_lists(db, db_user.id, board.id)
    return db_user


@router.post("/login", response_model=schemas.Token)
def login(user: schemas.UserCreate, db: Session = Depends(get_db)):
    user.username = (user.username or "").strip()
    limit_key = f"login:{user.username.lower()}"
    if not attempt_allowed(limit_key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SEC):
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
    token = create_access_token(
        data={"sub": db_user.username},
        expires_delta=timedelta(minutes=settings["ACCESS_TOKEN_EXPIRE_MINUTES"]),
    )
    return {"access_token": token, "token_type": "bearer"}
