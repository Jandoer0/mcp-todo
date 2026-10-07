"""MCP server exposed over Server-Sent Events (SSE).

Every tool requires an ``auth_token`` (a JWT). The token is decoded to find the
owning user so tools only ever touch that user's data.
"""
import json
from datetime import datetime
from typing import Optional

from mcp.server.fastmcp import FastMCP
from mcp.server.sse import SseServerTransport
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.routing import Route

from ..auth import decode_access_token
from ..db import SessionLocal
from ..models import Tag, Task, User, task_dependencies, task_tags
from ..routers.tasks import ensure_tags

mcp = FastMCP("OmniTask")


def _session() -> Session:
    return SessionLocal()


def get_user_from_token(token: str) -> Optional[User]:
    payload = decode_access_token(token)
    if not payload:
        return None
    username = payload.get("sub")
    if not username:
        return None
    db = _session()
    try:
        return db.query(User).filter(User.username == username).first()
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
    priority: int = 1,
    tags: Optional[list[str]] = None,
    list: str = "Входящие",
    blocked_by: Optional[list[int]] = None,
) -> str:
    """Create a new task for the authenticated user."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
    db = _session()
    try:
        task = Task(
            user_id=user.id,
            title=title,
            description=description,
            start_date=datetime.fromisoformat(start_date) if start_date else None,
            deadline=datetime.fromisoformat(deadline) if deadline else None,
            priority=priority,
            list=list,
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
    priority: Optional[int] = None,
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
        db.delete(task)
        db.commit()
        return f"Task {task.id} deleted"
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


# --- SSE transport wiring ---
sse = SseServerTransport("/messages/")


async def handle_sse(request: Request):
    async with sse.connect_sse(
        request.scope, request.receive, request._send
    ) as streams:
        await mcp.run(streams[0], streams[1], mcp.create_initialization_options())


async def handle_messages(request: Request):
    await sse.handle_post_message(request.scope, request.receive, request._send)


# Routes mounted by the application factory in main.py
mcp_routes = [
    Route("/sse", endpoint=handle_sse),
    Route("/messages", endpoint=handle_messages, methods=["POST"]),
]
