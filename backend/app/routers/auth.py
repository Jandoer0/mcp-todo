"""Authentication endpoints: register and login."""
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import create_access_token, get_password_hash, verify_password
from ..config import settings
from ..db import get_db
from ..models import User
from ..site_settings import get_bool

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/registration-status")
def registration_status(db: Session = Depends(get_db)):
    """Public flag so the login screen can hide the register option."""
    return {"enabled": get_bool(db, "allow_registration", True)}


@router.post("/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if not get_bool(db, "allow_registration", True):
        raise HTTPException(
            status_code=403, detail="Регистрация новых пользователей отключена"
        )
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")
    db_user = User(
        username=user.username,
        hashed_password=get_password_hash(user.password),
        role=user.role,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.post("/login", response_model=schemas.Token)
def login(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    token = create_access_token(
        data={"sub": db_user.username},
        expires_delta=timedelta(minutes=settings["ACCESS_TOKEN_EXPIRE_MINUTES"]),
    )
    return {"access_token": token, "token_type": "bearer"}
