"""MCP server exposed over Server-Sent Events (SSE).

Every tool requires an ``auth_token`` (a JWT). The token is decoded to find the
owning user so tools only ever touch that user's data.
"""
import json
import os

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy.orm import Session

from ..auth import decode_access_token, get_user_by_mcp_token
from ..db import SessionLocal
from ..models import Task, User
from ..routers.tasks import (
    advance_deadline,
    cycle_log,
    regenerate_cycle,
)
from ..services import task_service

mcp = FastMCP("OmniTask")


def _session() -> Session:
    return SessionLocal()


def get_user_from_token(token: str) -> User | None:
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
        names = list_names(db, user.id)
        mapping = {name: status_for_list(name) for name in names}
        lists_str = "\n".join([f"- {name} (status: {status})" for name, status in mapping.items()])
        return f"Available lists:\n{lists_str}"
    finally:
        db.close()


@mcp.tool()
def list_tasks(auth_token: str, status: str | None = None, cyclic: bool | None = None) -> str:
    """List tasks for the authenticated user. Optional status filter and cyclic filter (True = only cyclic tasks, False = only non-cyclic)."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        query = db.query(Task).filter(Task.user_id == user.id)
        if status:
            query = query.filter(Task.status == status)
        if cyclic is not None:
            query = query.filter(Task.is_cyclic == cyclic)
        tasks = query.all()
        tasks = task_service.list_tasks(db, user, status=status)
        result = []
        for t in tasks:
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
                    "tags": [tg.name for tg in t.tags],
                    "blocked_by": t.blocked_by,
                    "is_cyclic": bool(t.is_cyclic),
                    "cycle_period": t.cycle_period,
                    "cycle_interval": t.cycle_interval,
                    "cycle_group_id": t.cycle_group_id,
                    "reminder_days": t.reminder_days,
                    "cycle_dormant": t.cycle_dormant,
                }
            )
        return json.dumps(result)
    finally:
        db.close()


@mcp.tool()
def create_task(
    auth_token: str,
    title: str,
    description: str | None = None,
    start_date: str | None = None,
    deadline: str | None = None,
    priority: int = 2,
    tags: list[str] | None = None,
    list: str = "Не начато",
    blocked_by: list[int] | None = None,
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
        try:
            task = task_service.create_task(db, user, data)
        except task_service.TaskError as e:
            return f"Error: {e.message}"
        return f"Task created with ID {task.id}"
    finally:
        db.close()


@mcp.tool()
def update_task(
    auth_token: str,
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    status: str | None = None,
    priority: int | None = None,
    tags: list[str] | None = None,
    start_date: str | None = None,
    deadline: str | None = None,
    list: str | None = None,
    blocked_by: list[int] | None = None,
    is_cyclic: bool | None = None,
    cycle_period: str | None = None,
    cycle_interval: int | None = None,
    reminder_days: int | None = None,
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
        update_data = {
            k: v
            for k, v in data.items()
            if k not in ("auth_token", "task_id") and v is not None
        }
        # `list` is a builtin name in the tool signature; map it through.
        try:
            task = task_service.update_task(db, user, t_id, update_data)
        except LookupError:
            return "Task not found"
        except task_service.TaskError as e:
            return f"Error: {e.message}"
        # Cyclic completion via MCP: service already spawned the next iteration.
        if task.is_cyclic and task.status == "done":
            return (
                f"Cycle iteration completed. Next iteration created with ID "
                f"{task.id}, deadline {task.deadline}"
            )
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
        try:
            cyclic = (
                db.query(Task)
                .filter(Task.id == task_id, Task.user_id == user.id, Task.is_cyclic == True)
                .first()
            )
            group_id = cyclic.cycle_group_id if cyclic else None
            task_service.delete_task(db, user, task_id)
        except LookupError:
            return "Task not found"
        if group_id:
            return "Cyclic task chain deleted"
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
        if action in ("done", "complete"):  # 'done' kept for backwards compat
            action = "complete"
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
        import json as _json
        return _json.dumps(task_service.count_tasks(db, user))
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
