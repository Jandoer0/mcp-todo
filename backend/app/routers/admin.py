"""Admin endpoints: manage users and roles. Admin-only."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import (
    generate_mcp_token,
    get_current_admin,
    get_password_hash,
    hash_mcp_token,
)
from ..db import get_db
from ..models import User
from ..site_settings import get_bool, set_setting

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_admin)],
)


@router.get("/settings", response_model=schemas.SettingsResponse)
def get_settings(db: Session = Depends(get_db)):
    return {"allow_registration": get_bool(db, "allow_registration", True)}


@router.put("/settings/allow_registration", response_model=schemas.SettingsResponse)
def set_registration(enabled: bool, db: Session = Depends(get_db)):
    set_setting(db, "allow_registration", "true" if enabled else "false")
    return {"allow_registration": enabled}


@router.get("/users", response_model=list[schemas.UserResponse])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).all()


@router.post("/users", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    # Check if username exists
    existing = db.query(User).filter(User.username == user_in.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        username=user_in.username,
        hashed_password=get_password_hash(user_in.password),
        role=user_in.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.put("/users/{user_id}")
def update_user(user_id: int, user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user_in.username and user_in.username != user.username:
        # Check if new username is taken by someone else
        existing = db.query(User).filter(User.username == user_in.username).first()
        if existing and existing.id != user_id:
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = user_in.username
    
    # In a real app we'd check if password is provided and update it
    if user_in.password:
        user.hashed_password = get_password_hash(user_in.password)
    
    user.role = user_in.role
    db.commit()
    return {"ok": True, "message": f"User {user.username} updated"}

@router.put("/users/{user_id}/role")
def update_role(user_id: int, role: str, db: Session = Depends(get_db)):
    # This is kept for compatibility with current frontend
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return update_user(user_id, schemas.UserCreate(username=user.username, password="", role=role), db)



@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/mcp-token")
def regenerate_mcp_token(
    user_id: int,
    db: Session = Depends(get_db),
):
    """Create or rotate the user's long-lived MCP API key.

    Returns the raw token exactly once so the admin can copy it into the
    agent's configuration. Subsequent reads only report whether a key is set.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    token = generate_mcp_token()
    user.mcp_token_hash = hash_mcp_token(token)
    db.commit()
    return {"token": token, "set": True}


@router.delete("/users/{user_id}/mcp-token")
def revoke_mcp_token(
    user_id: int,
    db: Session = Depends(get_db),
):
    """Revoke the user's MCP API key."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.mcp_token_hash = None
    db.commit()
    return {"set": False}
