"""Admin endpoints: manage users and roles. Admin-only."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_admin
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


@router.put("/users/{user_id}")
def update_role(user_id: int, role: str, db: Session = Depends(get_db)):
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Invalid role")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = role
    db.commit()
    return {"ok": True, "message": f"User {user.username} role updated to {role}"}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"ok": True}
