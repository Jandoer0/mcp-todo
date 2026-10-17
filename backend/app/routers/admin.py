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
from ..models import User, Webhook
from ..services import server_stats as server_stats_service
from ..site_settings import DEFAULTS, get_bool, get_int, get_setting, set_setting

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_admin)],
)


def _current_settings(db: Session) -> dict:
    """Every tunable exposed by the admin panel (settings table + db quota)."""
    from ..site_settings import get_setting as _get

    def _int(key: str) -> int:
        try:
            return int(str(_get(db, key, DEFAULTS[key])).strip())
        except (TypeError, ValueError):
            return int(DEFAULTS[key])

    def _bool(key: str) -> bool:
        return get_bool(db, key, DEFAULTS[key] == "true")

    return {
        "allow_registration": get_bool(db, "allow_registration", True),
        "db_size_limit_mb": server_stats_service.get_db_size_limit_mb(db),
        "session_expire_minutes": _int("session_expire_minutes"),
        "login_rate_limit": _bool("login_rate_limit"),
        "login_max_attempts": _int("login_max_attempts"),
        "login_window_sec": _int("login_window_sec"),
        "register_rate_limit_per_hour": _int("register_rate_limit_per_hour"),
        "password_min_length": _int("password_min_length"),
        "max_body_mb": _int("max_body_mb"),
        "maintenance_mode": _bool("maintenance_mode"),
        "scheduler_interval_min": _int("scheduler_interval_min"),
        "deadline_window_hours": _int("deadline_window_hours"),
        "overdue_repeat_hours": _int("overdue_repeat_hours"),
        "webhook_timeout_sec": _int("webhook_timeout_sec"),
        "max_boards_per_user": _int("max_boards_per_user"),
        "max_description_length": _int("max_description_length"),
    }


@router.get("/settings", response_model=schemas.SettingsResponse)
def get_settings(db: Session = Depends(get_db)):
    return _current_settings(db)


@router.put("/settings", response_model=schemas.SettingsResponse)
def update_settings(data: schemas.AdminSettingsUpdate, db: Session = Depends(get_db)):
    """Partial update of the tunables; only provided fields are written.
    The scan-interval change is applied to the running scheduler immediately."""
    changed = data.model_dump(exclude_unset=True)
    for key, value in changed.items():
        set_setting(db, key, "true" if value is True else "false" if value is False else value)
    if "scheduler_interval_min" in changed:
        _reschedule_scheduler(changed["scheduler_interval_min"])
    return _current_settings(db)


def _reschedule_scheduler(minutes: int) -> None:
    """Apply a new scan interval to the running APScheduler job, if any."""
    try:
        from .. import main as _main

        if _main.app_scheduler is not None:
            _main.app_scheduler.reschedule_job(
                "check_due_tasks", trigger="interval", minutes=minutes
            )
    except Exception:  # scheduler absence must not fail the settings save
        pass


@router.put("/settings/allow_registration", response_model=schemas.SettingsResponse)
def set_registration(enabled: bool, db: Session = Depends(get_db)):
    set_setting(db, "allow_registration", "true" if enabled else "false")
    return {
        "allow_registration": enabled,
        "db_size_limit_mb": server_stats_service.get_db_size_limit_mb(db),
    }


@router.put("/settings/db_size_limit_mb", response_model=schemas.SettingsResponse)
def set_db_size_limit(limit_mb: int, db: Session = Depends(get_db)):
    return {
        "allow_registration": get_bool(db, "allow_registration", True),
        "db_size_limit_mb": server_stats_service.set_db_size_limit_mb(db, limit_mb),
    }


@router.get("/stats", response_model=schemas.ServerStatsResponse)
def get_stats(db: Session = Depends(get_db)):
    return server_stats_service.get_server_stats(db)


@router.get("/users", response_model=list[schemas.UserResponse])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).all()


@router.post("/users", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    # Check if username exists
    existing = db.query(User).filter(User.username == user_in.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
    if not user_in.password:
        # An empty password would mean "login without a password".
        raise HTTPException(status_code=422, detail="Пароль обязателен")

    user = User(
        username=user_in.username,
        hashed_password=get_password_hash(user_in.password),
        role=user_in.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    # Lists are per-user: seed the protected defaults for the new account.
    from ..board import ensure_default_board, ensure_default_lists

    board = ensure_default_board(db, user.id)
    ensure_default_lists(db, user.id, board.id)
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
    if user_in.webhooks_enabled is not None:
        user.webhooks_enabled = user_in.webhooks_enabled
        if not user_in.webhooks_enabled:
            # Disabling webhooks wipes their config: events are not sent.
            db.query(Webhook).filter(Webhook.user_id == user.id).delete()
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


# --- Webhooks ---

# Webhook configuration lives in the board editor (one webhook per board);
# the admin tab is a read-only overview of every webhook on the server.


@router.get("/webhooks", response_model=list[schemas.WebhookResponse])
def list_webhooks(user_id: int | None = None, db: Session = Depends(get_db)):
    """All webhooks on the server, sorted by user; board names are included
    for the read-only admin overview table."""
    from ..models import Board

    query = db.query(Webhook)
    if user_id is not None:
        query = query.filter(Webhook.user_id == user_id)
    webhooks = query.order_by(Webhook.user_id, Webhook.id).all()
    for w in webhooks:
        w.board_name = (
            db.query(Board.name).filter(Board.id == w.board_id).scalar()
            if w.board_id
            else None
        )
    return webhooks


@router.get("/users/{user_id}/boards")
def list_user_boards(user_id: int, db: Session = Depends(get_db)):
    """Boards of a user (for the webhook form's board selector)."""
    from ..models import Board

    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    boards = (
        db.query(Board)
        .filter(Board.user_id == user_id)
        .order_by(Board.position, Board.id)
        .all()
    )
    return [{"id": b.id, "name": b.name} for b in boards]


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
