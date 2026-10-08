"""Authentication: password hashing, JWT creation/validation, dependencies."""
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal, get_db
from .models import User

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    # argon2 has no 72-byte limit, but guard just in case
    pwd = password[:72] if isinstance(password, str) else password
    return pwd_context.hash(pwd)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=settings["ACCESS_TOKEN_EXPIRE_MINUTES"])
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings["SECRET_KEY"], algorithm=settings["ALGORITHM"])


def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings["SECRET_KEY"], algorithms=[settings["ALGORITHM"]])
    except JWTError:
        return None


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    username = payload.get("sub")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    return user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required"
        )
    return current_user


# --- Long-lived MCP API key -------------------------------------------------
def generate_mcp_token() -> str:
    """Return a new random API key for the agent (raw value, show once)."""
    return secrets.token_urlsafe(32)


def hash_mcp_token(token: str) -> str:
    """SHA-256 hex digest of a raw MCP token (safe to store)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_user_by_mcp_token(db: Session, token: str) -> Optional[User]:
    """Resolve a user from a long-lived MCP token, or None if it does not match."""
    if not token:
        return None
    return (
        db.query(User)
        .filter(User.mcp_token_hash == hash_mcp_token(token))
        .first()
    )
