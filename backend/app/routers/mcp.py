"""MCP server exposed over Server-Sent Events (SSE).

Every tool requires an ``auth_token`` (a JWT). The token is decoded to find the
owning user so tools only ever touch that user's data.
"""
import json
import os
from datetime import datetime
from typing import Optional, Annotated
from pydantic import Field

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import decode_access_token, get_user_by_mcp_token
from ..db import SessionLocal
from ..models import Tag, Task, User, task_dependencies, task_tags
from ..routers.tasks import ensure_tags

mcp = FastMCP("OmniTask")


def _session() -> Session:
    return SessionLocal()


def get_user_from_token(token: str) -> Optional[User]:
    """Resolve a user from either a JWT or a long-lived MCP API key."""
    # Standard JWT first (short-lived, stored statelessly).
    payload = decode_access_token(token)
    if payload and payload.get("sub"):
        db = _session()
        try:
            return db.query(User).filter(User.username == payload["sub"]).first()
        finally:
            db.close()
    # Fall back to the long-lived MCP API key (stored hashed on the user).
    db = _session()
    try:
        return get_user_by_mcp_token(db, token)
    finally:
        db.close()


@mcp.tool()
def reset_admin_password(username: str, new_password: str) -> str:
    """Reset password for a user. Use with caution!"""
    from ..auth import get_password_hash
    db = _session()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return f"User {username} not found"
        user.password = get_password_hash(new_password)
        db.commit()
        return f"Password for {username} has been reset successfully"
    finally:
        db.close()


@mcp.tool()
def get_my_profile(auth_token: str) -> str:
    """Get information about the current authenticated user (ID, role)."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    return f"User: {user.username}, ID: {user.id}, Role: {user.role}"


@mcp.tool()
def list_all_lists(auth_token: str) -> str:
    """List all available task lists (categories) and their corresponding statuses."""
    from ..board import list_names, status_for_list
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        names = list_names(db)
        mapping = {name: status_for_list(name) for name in names}
        lists_str = "\n".join([f"- {name} (status: {status})" for name, status in mapping.items()])
        return f"Available lists:\n{lists_str}"
    finally:
        db.close()


@mcp.tool()
def list_tasks(auth_token: str, status: Optional[str] = None) -> str:
    """List tasks for the authenticated user. Optional status filter."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        query = db.query(Task).filter(Task.user_id == user.id)
        if status:
            query = query.filter(Task.status == status)
        tasks = query.all()
        return json.dumps(
            [
                {
                    "id": t.id,
                    "title": t.title,
                    "status": t.status,
                    "priority": t.priority,
                    "start_date": str(t.start_date) if t.start_date else None,
                    "deadline": str(t.deadline) if t.deadline else None,
                    "list": t.list,
                    "tags": [
                        tg.name
                        for tg in db.query(Tag)
                        .join(task_tags, Tag.id == task_tags.c.tag_id)
                        .filter(task_tags.c.task_id == t.id)
                        .all()
                    ],
                    "blocked_by": [
                        r[0]
                        for r in db.execute(
                            select(task_dependencies.c.blocker_id).where(
                                task_dependencies.c.blocked_id == t.id
                            )
                        ).fetchall()
                    ],
                }
                for t in tasks
            ]
        )
    finally:
        db.close()


@mcp.tool()
def create_task(
    auth_token: str,
    title: str,
    description: Optional[str] = None,
    start_date: Optional[str] = None,
    deadline: Optional[str] = None,
    priority: int = Field(default=2, description="Уровень приоритета задачи. Шкала: 1 = Низкий, 2 = Средний, 3 = Высокий"),
    tags: Optional[list[str]] = None,
    list: str = "Не начато",
    blocked_by: Optional[list[int]] = None,
) -> str:
    """Create a new task for the authenticated user."""
    from ..board import list_names, status_for_list
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        # Validate list name. If it doesn't exist, fall back to default.
        valid_lists = list_names(db)
        if list not in valid_lists:
            list = "Не начато"
        
        task = Task(
            user_id=user.id,
            title=title,
            description=description,
            start_date=datetime.fromisoformat(start_date) if start_date else None,
            deadline=datetime.fromisoformat(deadline) if deadline else None,
            priority=priority,
            list=list,
            status=status_for_list(list),
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        if tags:
            task.tags = ensure_tags(db, tags)
            db.commit()
        if blocked_by:
            seen = set()
            for bid in blocked_by:
                if bid == task.id or bid in seen:
                    continue
                seen.add(bid)
                blocker = db.get(Task, bid)
                if not blocker or blocker.user_id != user.id:
                    continue
                db.execute(
                    task_dependencies.insert().values(
                        blocker_id=bid, blocked_id=task.id
                    )
                )
            db.commit()
        return f"Task created with ID {task.id}"
    finally:
        db.close()


@mcp.tool()
def update_task(
    auth_token: str,
    task_id: int,
    title: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[int] = Field(default=None, description="Уровень приоритета задачи. Шкала: 1 = Низкий, 2 = Средний, 3 = Высокий"),
    tags: Optional[list[str]] = None,
    start_date: Optional[str] = None,
    deadline: Optional[str] = None,
    list: Optional[str] = None,
    blocked_by: Optional[list[int]] = None,
) -> str:
    """Update an existing task for the authenticated user."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        task = (
            db.query(Task)
            .filter(Task.id == task_id, Task.user_id == user.id)
            .first()
        )
        if not task:
            return "Task not found"
        if title is not None:
            task.title = title
        if status is not None:
            task.status = status
        if priority is not None:
            task.priority = priority
        if tags is not None:
            task.tags = ensure_tags(db, tags)
        if start_date is not None:
            task.start_date = datetime.fromisoformat(start_date) if start_date else None
        if deadline is not None:
            task.deadline = datetime.fromisoformat(deadline) if deadline else None
        if list is not None:
            task.list = list
        if blocked_by is not None:
            db.execute(
                task_dependencies.delete().where(
                    task_dependencies.c.blocked_id == task.id
                )
            )
            seen = set()
            for bid in blocked_by:
                if bid == task.id or bid in seen:
                    continue
                seen.add(bid)
                blocker = db.get(Task, bid)
                if not blocker or blocker.user_id != user.id:
                    continue
                db.execute(
                    task_dependencies.insert().values(
                        blocker_id=bid, blocked_id=task.id
                    )
                )
        db.commit()
        return f"Task {task.id} updated"
    finally:
        db.close()


@mcp.tool()
def delete_task(auth_token: str, task_id: int) -> str:
    """Delete a task for the authenticated user."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        task = (
            db.query(Task)
            .filter(Task.id == task_id, Task.user_id == user.id)
            .first()
        )
        if not task:
            return "Task not found"
        # Clean up dependencies to avoid orphaned records or constraint issues
        db.execute(
            task_dependencies.delete().where(
                (task_dependencies.c.blocker_id == task_id)
                | (task_dependencies.c.blocked_id == task_id)
            )
        )
        db.delete(task)
        db.commit()
        return f"Task {task_id} deleted"
    finally:
        db.close()


@mcp.tool()
def search_tasks(auth_token: str, query_str: str) -> str:
    """Search tasks by title or description for the authenticated user."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        tasks = (
            db.query(Task)
            .filter(
                Task.user_id == user.id,
                (Task.title.ilike(f"%{query_str}%"))
                | (Task.description.ilike(f"%{query_str}%")),
            )
            .all()
        )
        return json.dumps(
            [{"id": t.id, "title": t.title, "status": t.status} for t in tasks]
        )
    finally:
        db.close()


@mcp.tool()
def get_project_summary(auth_token: str) -> str:
    """Return a summary of the authenticated user's tasks."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        uid = user.id
        total = db.query(Task).filter(Task.user_id == uid).count()
        todo = db.query(Task).filter(Task.user_id == uid, Task.status == "todo").count()
        in_progress = db.query(Task).filter(
            Task.user_id == uid, Task.status == "in_progress"
        ).count()
        done = db.query(Task).filter(Task.user_id == uid, Task.status == "done").count()
        overdue = db.query(Task).filter(
            Task.user_id == uid,
            Task.deadline < datetime.utcnow(),
            Task.status != "done",
        ).count()
        return json.dumps(
            {
                "total": total,
                "todo": todo,
                "in_progress": in_progress,
                "done": done,
                "overdue": overdue,
            }
        )
    finally:
        db.close()


# --- SSE transport wiring -------------------------------------------------
# We deliberately disable DNS-rebinding protection (or restrict it via the
# MCP_ALLOWED_HOSTS env var) so the server is reachable behind a reverse proxy
# or from any host. The original hand-rolled transport did not enforce it, and
# the FastMCP default would otherwise reject every request whose Host header is
# not localhost/127.0.0.1 with HTTP 421 -- which is exactly what broke tool
# discovery. The constructor auto-enables the protection for host=127.0.0.1, so
# we override it here.
_allowed_hosts = [h.strip() for h in os.getenv("MCP_ALLOWED_HOSTS", "").split(",") if h.strip()]
if _allowed_hosts:
    mcp.settings.transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=_allowed_hosts,
        allowed_origins=[f"http://{h}" for h in _allowed_hosts],
    )
else:
    mcp.settings.transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=False
    )


def _build_mcp_routes():
    """Build the SSE routes from FastMCP's official ``sse_app()``.

    Using the library's own SSE app guarantees the handshake
    (initialize / tools/list / tools/call) is implemented correctly, so all
    registered tools are discoverable by standard MCP clients.
    """
    sse_app = mcp.sse_app()
    return list(sse_app.routes)


# Routes mounted by the application factory in main.py.
mcp_routes = _build_mcp_routes()
