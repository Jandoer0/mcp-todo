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
from ..services.notification_service import EVENTS
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
    # Lists are per-user: seed the protected defaults for the new account.
    from ..board import ensure_default_lists

    ensure_default_lists(db, user.id)
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


# --- Webhooks ---


def _validate_events(events: list[str], excluded: list[str]) -> None:
    unknown = [e for e in (*events, *excluded) if e not in EVENTS]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Неизвестные события: {', '.join(unknown)}",
        )


@router.get("/webhooks", response_model=list[schemas.WebhookResponse])
def list_webhooks(user_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(Webhook)
    if user_id is not None:
        query = query.filter(Webhook.user_id == user_id)
    return query.order_by(Webhook.id).all()


@router.post("/webhooks", response_model=schemas.WebhookResponse, status_code=status.HTTP_201_CREATED)
def create_webhook(data: schemas.WebhookCreate, db: Session = Depends(get_db)):
    if not db.query(User).filter(User.id == data.user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    _validate_events(data.events, data.excluded_events)
    webhook = Webhook(**data.model_dump())
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    return webhook


@router.put("/webhooks/{webhook_id}", response_model=schemas.WebhookResponse)
def update_webhook(
    webhook_id: int,
    data: schemas.WebhookUpdate,
    db: Session = Depends(get_db),
):
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    payload = data.model_dump(exclude_unset=True)
    if "events" in payload or "excluded_events" in payload:
        _validate_events(
            payload.get("events", webhook.events or []),
            payload.get("excluded_events", webhook.excluded_events or []),
        )
    for key, value in payload.items():
        setattr(webhook, key, value)
    db.commit()
    db.refresh(webhook)
    return webhook


@router.delete("/webhooks/{webhook_id}")
def delete_webhook(webhook_id: int, db: Session = Depends(get_db)):
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    db.delete(webhook)
    db.commit()
    return {"ok": True}


@router.post("/webhooks/{webhook_id}/test")
async def test_webhook(webhook_id: int, db: Session = Depends(get_db)):
    """Send a test notification synchronously and report the delivery result,
    so the admin immediately sees whether the endpoint is reachable."""
    import httpx

    from ..services import notification_service as ns

    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    headers = {"Content-Type": "application/json"}
    if webhook.token:
        headers["Authorization"] = f"Bearer {webhook.token}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                webhook.url, json=ns.send_test(webhook), headers=headers
            )
        ok = resp.status_code < 400
        return {
            "ok": ok,
            "status_code": resp.status_code,
            "error": None if ok else f"HTTP {resp.status_code}",
        }
    except Exception as exc:
        return {"ok": False, "status_code": None, "error": str(exc)}


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
