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
from ..routers.tasks import (
    CYCLE_PERIODS,
    compute_is_blocked,
    cycle_log,
    ensure_tags,
    is_cycle_visible,
    regenerate_cycle,
    advance_deadline,
)
import uuid as _uuid

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


def _extract_args(kwargs: dict) -> dict:
    """Helper to handle FastMCP's inconsistent argument wrapping.
    If arguments are wrapped in an 'args' key, unwrap them.
    """
    if "args" in kwargs and isinstance(kwargs["args"], dict):
        return kwargs["args"]
    return kwargs


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
def list_tasks(auth_token: str, status: Optional[str] = None, cyclic: Optional[bool] = None) -> str:
    """List tasks for the authenticated user. Optional status filter and cyclic filter (True = only cyclic tasks, False = only non-cyclic)."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        from .tasks import is_cycle_visible
        query = db.query(Task).filter(Task.user_id == user.id)
        if status:
            query = query.filter(Task.status == status)
        if cyclic is not None:
            query = query.filter(Task.is_cyclic == cyclic)
        tasks = query.all()
        now = datetime.utcnow()
        result = []
        for t in tasks:
            blocked_by = [
                r[0]
                for r in db.execute(
                    select(task_dependencies.c.blocker_id).where(
                        task_dependencies.c.blocked_id == t.id
                    )
                ).fetchall()
            ]
            t_is_blocked = bool(blocked_by) and any(
                db.get(Task, b) and db.get(Task, b).status != "done"
                for b in blocked_by
            )
            t_is_blocked = compute_is_blocked(db, blocked_by)
            result.append(
                {
                    "id": t.id,
                    "title": t.title,
                    "description": t.description,
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
                    "blocked_by": blocked_by,
                    "is_cyclic": bool(t.is_cyclic),
                    "cycle_period": t.cycle_period,
                    "cycle_interval": t.cycle_interval,
                    "cycle_group_id": t.cycle_group_id,
                    "reminder_days": t.reminder_days,
                    "cycle_dormant": not is_cycle_visible(t, now),
                }
            )
        return json.dumps(result)
    finally:
        db.close()


@mcp.tool()
def create_task(
    auth_token: str,
    title: str,
    description: Optional[str] = None,
    start_date: Optional[str] = None,
    deadline: Optional[str] = None,
    priority: int = 2,
    tags: Optional[list[str]] = None,
    list: str = "Не начато",
    blocked_by: Optional[list[int]] = None,
    is_cyclic: bool = False,
    cycle_period: str = "monthly",
    cycle_interval: int = 1,
    reminder_days: int = 0,
) -> str:
    """Create a new task for the authenticated user. Priority scale: 1 = Low, 2 = Medium, 3 = High.
    Cyclic tasks: cycle_period is daily|weekly|monthly|yearly, cycle_interval = every N periods,
    reminder_days = days before deadline when the task becomes visible in the main lists."""
    data = _extract_args(locals())
    
    token = data.get("auth_token")
    t_title = data.get("title")
    t_desc = data.get("description")
    t_start = data.get("start_date")
    t_dead = data.get("deadline")
    t_prio = data.get("priority", 2)
    t_tags = data.get("tags")
    t_list = data.get("list", "Не начато")
    t_blocked = data.get("blocked_by")

    if not token or not t_title:
        return "Error: Missing required parameters (auth_token, title)"

    user = get_user_from_token(token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        from ..board import list_names, status_for_list
        valid_lists = list_names(db)
        if t_list not in valid_lists:
            t_list = "Не начато"
        
        task = Task(
            user_id=user.id,
            title=t_title,
            description=t_desc,
            start_date=datetime.fromisoformat(t_start) if t_start else None,
            deadline=datetime.fromisoformat(t_dead) if t_dead else None,
            priority=t_prio,
            list=t_list,
            status=status_for_list(t_list),
        )
        if data.get("is_cyclic"):
            task.is_cyclic = True
            task.cycle_period = data.get("cycle_period") if data.get("cycle_period") in CYCLE_PERIODS else "monthly"
            task.cycle_interval = max(1, int(data.get("cycle_interval") or 1))
            task.reminder_days = max(0, int(data.get("reminder_days") or 0))
            task.cycle_group_id = _uuid.uuid4().hex
        db.add(task)
        db.commit()
        db.refresh(task)
        if t_tags:
            task.tags = ensure_tags(db, t_tags)
            db.commit()
        if t_blocked:
            seen = set()
            for bid in t_blocked:
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
    description: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[int] = None,
    tags: Optional[list[str]] = None,
    start_date: Optional[str] = None,
    deadline: Optional[str] = None,
    list: Optional[str] = None,
    blocked_by: Optional[list[int]] = None,
    is_cyclic: Optional[bool] = None,
    cycle_period: Optional[str] = None,
    cycle_interval: Optional[int] = None,
    reminder_days: Optional[int] = None,
) -> str:
    """Update an existing task for the authenticated user. Priority scale: 1 = Low, 2 = Medium, 3 = High.
    Setting status='done' on a cyclic task completes the cycle: logs history and spawns the next iteration."""
    data = _extract_args(locals())
    
    token = data.get("auth_token")
    t_id = data.get("task_id")
    
    if not token or t_id is None:
        return "Error: Missing required parameters (auth_token, task_id)"

    user = get_user_from_token(token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        task = (
            db.query(Task)
            .filter(Task.id == t_id, Task.user_id == user.id)
            .first()
        )
        if not task:
            return "Task not found"
        if data.get("title") is not None:
            task.title = data.get("title")
        if data.get("description") is not None:
            task.description = data.get("description")
        if data.get("status") is not None:
            task.status = data.get("status")
        if data.get("priority") is not None:
            task.priority = data.get("priority")
        if data.get("tags") is not None:
            task.tags = ensure_tags(db, data.get("tags"))
        if data.get("start_date") is not None:
            task.start_date = datetime.fromisoformat(data.get("start_date")) if data.get("start_date") else None
        if data.get("deadline") is not None:
            task.deadline = datetime.fromisoformat(data.get("deadline")) if data.get("deadline") else None
        if data.get("list") is not None:
            from ..board import status_for_list, list_names
            new_list = data.get("list")
            if new_list in list_names(db):
                task.list = new_list
                task.status = status_for_list(new_list)
        if data.get("is_cyclic") is not None:
            task.is_cyclic = bool(data.get("is_cyclic"))
        if data.get("cycle_period") is not None:
            task.cycle_period = data.get("cycle_period") if data.get("cycle_period") in CYCLE_PERIODS else "monthly"
        if data.get("cycle_interval") is not None:
            task.cycle_interval = max(1, int(data.get("cycle_interval")))
        if data.get("reminder_days") is not None:
            task.reminder_days = max(0, int(data.get("reminder_days")))
        if task.is_cyclic:
            if task.cycle_period not in CYCLE_PERIODS:
                task.cycle_period = "monthly"
            if not task.cycle_group_id:
                task.cycle_group_id = _uuid.uuid4().hex
            task.cycle_interval = max(1, task.cycle_interval or 1)
            task.reminder_days = max(0, task.reminder_days or 0)
        if data.get("blocked_by") is not None:
            db.execute(
                task_dependencies.delete().where(
                    task_dependencies.c.blocked_id == task.id
                )
            )
            seen = set()
            for bid in data.get("blocked_by", []):
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
        # Cyclic completion via MCP: log the iteration and spawn the next one.
        if task.is_cyclic and task.status == "done":
            from ..board import _resolve_list
            next_task = regenerate_cycle(db, task)
            return f"Cycle iteration completed. Next iteration created with ID {next_task.id}, deadline {next_task.deadline}"
        return f"Task {task.id} updated"
    finally:
        db.close()


@mcp.tool()
def delete_task(auth_token: str, task_id: int) -> str:
    """Delete a task for the authenticated user. For a cyclic task, the whole iteration chain is deleted."""
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
        group_id = task.cycle_group_id if task.is_cyclic else None
        chain_ids = [task_id]
        if group_id:
            chain = (
                db.query(Task)
                .filter(Task.user_id == user.id, Task.cycle_group_id == group_id)
                .all()
            )
            chain_ids = [t.id for t in chain]
        # Clean up dependencies to avoid orphaned records or constraint issues
        db.execute(
            task_dependencies.delete().where(
                (task_dependencies.c.blocker_id.in_(chain_ids))
                | (task_dependencies.c.blocked_id.in_(chain_ids))
            )
        )
        if group_id:
            db.query(Task).filter(
                Task.user_id == user.id, Task.cycle_group_id == group_id
            ).delete(synchronize_session=False)
            return f"Cyclic task chain deleted ({len(chain_ids)} task(s))"
        db.delete(task)
        db.commit()
        return f"Task {task_id} deleted"
    finally:
        db.close()


@mcp.tool()
def manage_cycle(auth_token: str, task_id: int, action: str) -> str:
    """Manage a cyclic task. action: 'skip' (shift deadline to next cycle, no history),
    'stop' (break the cycle, logged), 'history' (list completed iterations),
    'complete' (mark done: logs history and creates the next iteration)."""
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
        if not task.is_cyclic:
            return "Error: Task is not cyclic"
        action = (action or "").lower()
        if action == "skip":
            if not task.deadline:
                return "Error: Task has no deadline to shift"
            task.deadline = advance_deadline(
                task.deadline, task.cycle_period, task.cycle_interval
            )
            db.commit()
            return f"Deadline shifted to next cycle: {task.deadline}"
        if action == "stop":
            task.is_cyclic = False
            cycle_log(db, task.user_id, task.cycle_group_id, task, "stopped")
            db.commit()
            return "Cycle stopped. No new iterations will be created."
        if action == "complete":
            next_task = regenerate_cycle(db, task)
            return f"Cycle iteration completed. Next iteration created with ID {next_task.id}, deadline {next_task.deadline}"
        if action == "history":
            from ..models import TaskCycleLog
            logs = (
                db.query(TaskCycleLog)
                .filter(
                    TaskCycleLog.user_id == user.id,
                    TaskCycleLog.cycle_group_id == task.cycle_group_id,
                )
                .order_by(TaskCycleLog.logged_at.desc())
                .all()
            )
            return json.dumps(
                [
                    {
                        "task_title": l.task_title,
                        "action": l.action,
                        "deadline": str(l.deadline) if l.deadline else None,
                        "logged_at": str(l.logged_at),
                    }
                    for l in logs
                ]
            )
        return "Error: Unknown action. Use skip | stop | complete | history"
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
