"""Task service: the single implementation of task business logic.

Both the REST router (routers/tasks.py) and the MCP tools (routers/mcp.py)
are thin wrappers around these functions, so behavior can never diverge
between the two layers. All functions are user-scoped: `user` must be a
models.User; foreign objects are treated as "not found".
"""
import uuid as _uuid
from datetime import datetime

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from ..clock import utcnow
from ..board import PALETTE, list_colors, list_names, status_for_kind
from ..models import (
    Tag,
    Task,
    TaskCycleLog,
    TaskList,
    User,
    task_dependencies,
    task_tags,
)
from ..routers.tags import cleanup_orphan_tags

_PROTECTED_FIELDS = {"id", "user_id", "auth_token"}  # never settable via payload


class TaskError(Exception):
    """Business-rule violation with a user-facing message."""

    def __init__(self, message: str):
        self.message = message


# --- helpers for the blocking-task (dependencies) graph ---

def get_blocker_ids(db: Session, task_id: int) -> list[int]:
    rows = db.execute(
        select(task_dependencies.c.blocker_id).where(
            task_dependencies.c.blocked_id == task_id
        )
    ).fetchall()
    return [r[0] for r in rows]


def compute_is_blocked(db: Session, blocker_ids: list[int]) -> bool:
    if not blocker_ids:
        return False
    count = db.execute(
        select(func.count(Task.id)).where(
            Task.id.in_(blocker_ids), Task.status != "done"
        )
    ).scalar()
    return (count or 0) > 0


def set_blockers(db: Session, task_id: int, blocker_ids, user_id: int) -> None:
    db.execute(
        sa_delete(task_dependencies).where(
            task_dependencies.c.blocked_id == task_id
        )
    )
    seen: set[int] = set()
    for bid in (blocker_ids or []):
        if bid == task_id or bid in seen:
            continue
        seen.add(bid)
        blocker = db.get(Task, bid)
        if not blocker or blocker.user_id != user_id:
            continue
        existing = db.execute(
            select(task_dependencies).where(
                task_dependencies.c.blocked_id == bid,
                task_dependencies.c.blocker_id == task_id,
            )
        ).first()
        if existing:
            continue
        db.execute(
            insert(task_dependencies).values(blocker_id=bid, blocked_id=task_id)
        )


def tag_palette(db, user_id: int) -> list:
    """Colors available for tags: the full PALETTE minus colors taken by the
    user's own lists. Per AGENTS.md there are 18 presets; when they run out,
    colors repeat."""
    used_by_lists = list_colors(db, user_id)
    return [c for c in PALETTE if c not in used_by_lists]


def _pick_tag_color(db, user_id: int) -> str:
    """Pick a color for a new tag: first unused one, otherwise cycle deterministically
    by the count of existing tags (colors repeat when the palette is exhausted)."""
    avail = tag_palette(db, user_id)
    if not avail:
        avail = list(PALETTE)
    used = {t.color for t in db.query(Tag).filter(Tag.user_id == user_id).all()}
    color = next((c for c in avail if c not in used), None)
    if color is None:
        count = db.query(Tag).filter(Tag.user_id == user_id).count()
        color = avail[count % len(avail)]
    return color


def repair_tag_colors(db, user_id: int) -> int:
    """Reassign colors to tags that ended up with a color not allowed for tags
    (e.g. the gray fallback colliding with the 'Не начато' list color)."""
    avail = tag_palette(db, user_id)
    if not avail:
        avail = list(PALETTE)
    allowed = set(avail)
    tags = db.query(Tag).filter(Tag.user_id == user_id).all()
    used = {t.color for t in tags if t.color in allowed}
    fixed = 0
    for tag in tags:
        if tag.color in allowed:
            continue
        color = next((c for c in avail if c not in used), None)
        if color is None:
            color = avail[fixed % len(avail)]
        tag.color = color
        used.add(color)
        fixed += 1
    if fixed:
        db.commit()
    return fixed


def ensure_tags(db: Session, names, user_id: int) -> list:
    """Ensure Tag rows exist for each name (auto color, never colliding with
    list colors; colors repeat cyclically when the palette is exhausted).
    Tags are scoped to the given user.
    Returns the list of Tag ORM objects."""
    if not names:
        return []

    result = []
    for name in names:
        name = (name or "").strip()
        if not name:
            continue
        tag = (
            db.query(Tag)
            .filter(Tag.name == name, Tag.user_id == user_id)
            .first()
        )
        if not tag:
            tag = Tag(name=name, color=_pick_tag_color(db, user_id), user_id=user_id)
            db.add(tag)
            db.commit()
            db.refresh(tag)
        result.append(tag)
    return result


def _attach_state(db: Session, task: Task) -> Task:
    """Set transient attributes used for serialization (single task)."""
    _attach_state_many(db, [task])
    return task


def _attach_state_many(db: Session, tasks: list[Task]) -> None:
    """Same as _attach_state but for a batch of tasks: 3 queries total
    instead of 3 per task (avoids the N+1 problem on list endpoints)."""
    if not tasks:
        return
    ids = [t.id for t in tasks]

    blocker_rows = db.execute(
        select(
            task_dependencies.c.blocked_id, task_dependencies.c.blocker_id
        ).where(task_dependencies.c.blocked_id.in_(ids))
    ).fetchall()
    blockers_by_task = {}
    for blocked_id, blocker_id in blocker_rows:
        blockers_by_task.setdefault(blocked_id, []).append(blocker_id)

    # Statuses of all referenced blockers, in one query.
    all_blockers = {b for bl in blockers_by_task.values() for b in bl}
    statuses = (
        dict(db.query(Task.id, Task.status).filter(Task.id.in_(all_blockers)).all())
        if all_blockers
        else {}
    )

    tag_rows = (
        db.query(task_tags.c.task_id, Tag)
        .join(Tag, Tag.id == task_tags.c.tag_id)
        .filter(task_tags.c.task_id.in_(ids))
        .all()
    )
    tags_by_task = {}
    for task_id, tag in tag_rows:
        tags_by_task.setdefault(task_id, []).append(tag)

    for t in tasks:
        bl = blockers_by_task.get(t.id, [])
        t.blocked_by = bl
        t.is_blocked = any(statuses.get(b) != "done" for b in bl)
        t.tags = sorted(tags_by_task.get(t.id, []), key=lambda g: g.name)


def _resolve_list(db: Session, name: str | None, user_id: int) -> str:
    """Return one of the user's list names, falling back to the default
    'not started' list."""
    if name and name in list_names(db, user_id):
        return name
    return "Не начато"


# ---------------- Cyclic tasks ----------------

from datetime import timedelta as _timedelta

CYCLE_PERIODS = {"daily", "weekly", "monthly", "yearly"}


def advance_deadline(dt: datetime, period: str, interval: int) -> datetime:
    """Shift a deadline by (interval * period)."""
    interval = max(1, interval or 1)
    if period == "daily":
        return dt + _timedelta(days=interval)
    if period == "weekly":
        return dt + _timedelta(weeks=interval)
    if period == "monthly":
        total = dt.month - 1 + interval
        year = dt.year + total // 12
        month = total % 12 + 1
        day = min(dt.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
        return dt.replace(year=year, month=month, day=day)
    if period == "yearly":
        year = dt.year + interval
        day = min(dt.day, 29 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 28) if dt.month == 2 else dt.day
        return dt.replace(year=year, day=day)
    return dt + _timedelta(days=interval)


def cycle_log(db: Session, user_id: int, group_id: str, task: Task, action: str) -> None:
    db.add(
        TaskCycleLog(
            user_id=user_id,
            cycle_group_id=group_id,
            task_title=task.title,
            action=action,
            deadline=task.deadline,
        )
    )


def regenerate_cycle(db: Session, task: Task) -> Task:
    """Complete a cyclic iteration: log it, spawn the next one, drop the current.
    Returns the newly created next iteration."""
    next_deadline = (
        advance_deadline(task.deadline, task.cycle_period, task.cycle_interval)
        if task.deadline
        else None
    )
    next_task = Task(
        user_id=task.user_id,
        title=task.title,
        description=task.description,
        priority=task.priority,
        deadline=next_deadline,
        start_date=task.start_date,
        status="todo",
        list=_resolve_list(db, "Не начато", task.user_id)[0],
        is_cyclic=True,
        cycle_period=task.cycle_period,
        cycle_interval=task.cycle_interval,
        cycle_group_id=task.cycle_group_id,
        reminder_days=task.reminder_days,
    )
    next_task.tags = list(task.tags)
    cycle_log(db, task.user_id, task.cycle_group_id, task, "completed")
    db.add(next_task)
    db.flush()
    db.execute(
        sa_delete(task_dependencies).where(
            (task_dependencies.c.blocker_id == task.id)
            | (task_dependencies.c.blocked_id == task.id)
        )
    )
    db.delete(task)
    db.commit()
    db.refresh(next_task)
    return next_task


def is_cycle_visible(task: Task, now: datetime) -> bool:
    """Smart visibility: a dormant cyclic task is hidden until its reminder
    window opens; blocked tasks stay visible to show the dependency chain."""
    if not task.is_cyclic:
        return True
    if getattr(task, "is_blocked", False):
        return True
    if not task.deadline:
        return True
    window_start = task.deadline - _timedelta(days=max(0, task.reminder_days or 0))
    return now >= window_start




def _resolve_list(db: Session, name: str | None, user_id: int) -> tuple[str, str]:
    """Resolve a list name to (list_name, task_status). The status comes from
    the list's editable kind; unknown names fall back to the user's
    'Не начато' list."""
    row = None
    if name:
        row = (
            db.query(TaskList)
            .filter(TaskList.user_id == user_id, TaskList.name == name)
            .first()
        )
    if not row:
        row = (
            db.query(TaskList)
            .filter(TaskList.user_id == user_id, TaskList.name == "Не начато")
            .first()
        )
    if not row:
        return ("Не начато", "todo")
    return (row.name, status_for_kind(row.kind))


def _normalize_cyclic(task: Task, data: dict) -> None:
    if data.get("is_cyclic"):
        if data.get("cycle_period") not in CYCLE_PERIODS:
            task.cycle_period = "monthly"
        if not task.cycle_group_id:
            task.cycle_group_id = _uuid.uuid4().hex
    if task.is_cyclic:
        if task.cycle_period not in CYCLE_PERIODS:
            task.cycle_period = "monthly"
        if not task.cycle_group_id:
            task.cycle_group_id = _uuid.uuid4().hex
        task.cycle_interval = max(1, task.cycle_interval or 1)
        task.reminder_days = max(0, task.reminder_days or 0)


def list_tasks(
    db: Session, user: User, status: str | None = None, list_name: str | None = None
) -> list[Task]:
    query = db.query(Task).filter(Task.user_id == user.id)
    if status:
        query = query.filter(Task.status == status)
    if list_name:
        query = query.filter(Task.list == list_name)
    tasks = query.all()
    _attach_state_many(db, tasks)
    now = utcnow()
    for t in tasks:
        t.cycle_dormant = not is_cycle_visible(t, now)
    return tasks


def create_task(db: Session, user: User, data: dict) -> Task:
    data = {k: v for k, v in data.items() if k not in _PROTECTED_FIELDS}
    blocked_by = data.pop("blocked_by", None)
    tag_names = data.pop("tags", None)

    list_name, list_status = _resolve_list(db, data.get("list"), user.id)
    data["list"] = list_name
    data["status"] = list_status

    if data.get("status") == "done" and compute_is_blocked(db, blocked_by or []):
        raise TaskError("Невозможно выполнить задачу: есть незавершённые блокирующие задачи")

    task = Task(user_id=user.id, **data)
    _normalize_cyclic(task, data)
    db.add(task)
    db.commit()
    db.refresh(task)

    if tag_names is not None:
        task.tags = ensure_tags(db, tag_names, user.id)
        db.commit()
    if blocked_by is not None:
        set_blockers(db, task.id, blocked_by, user.id)
        db.commit()
        db.refresh(task)
    return task


def update_task(db: Session, user: User, task_id: int, data: dict) -> Task:
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == user.id)
        .first()
    )
    if not task:
        raise LookupError("Task not found")

    data = {k: v for k, v in data.items() if k not in _PROTECTED_FIELDS}
    has_blocked_by = "blocked_by" in data
    blocked_by = data.pop("blocked_by", None)
    has_tags = "tags" in data
    tag_names = data.pop("tags", None)

    if "list" in data:
        list_name, list_status = _resolve_list(db, data["list"], user.id)
        data["list"] = list_name
        data["status"] = list_status

    for key, value in data.items():
        setattr(task, key, value)
    _normalize_cyclic(task, data)

    if has_tags:
        task.tags = ensure_tags(db, tag_names or [], user.id)
        cleanup_orphan_tags(db, user.id)

    # A task cannot be marked done (moved to "Готово") while still blocked.
    if task.status == "done":
        ids = blocked_by if has_blocked_by else [
            r[0]
            for r in db.execute(
                select(task_dependencies.c.blocker_id).where(
                    task_dependencies.c.blocked_id == task.id
                )
            ).fetchall()
        ]
        if compute_is_blocked(db, ids or []):
            raise TaskError("Невозможно выполнить задачу: есть незавершённые блокирующие задачи")

    db.commit()
    if has_blocked_by:
        set_blockers(db, task.id, blocked_by, user.id)
        db.commit()
    db.refresh(task)

    # Cyclic task completed: log the iteration and spawn the next one.
    if task.is_cyclic and task.status == "done":
        return regenerate_cycle(db, task)
    return task


def delete_task(db: Session, user: User, task_id: int) -> None:
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == user.id)
        .first()
    )
    if not task:
        raise LookupError("Task not found")

    group_id = task.cycle_group_id if task.is_cyclic else None
    chain_ids = [task_id]
    if group_id:
        chain = (
            db.query(Task)
            .filter(Task.user_id == user.id, Task.cycle_group_id == group_id)
            .all()
        )
        chain_ids = [t.id for t in chain]

    db.execute(
        sa_delete(task_dependencies).where(
            (task_dependencies.c.blocker_id.in_(chain_ids))
            | (task_dependencies.c.blocked_id.in_(chain_ids))
        )
    )
    if group_id:
        db.query(Task).filter(
            Task.user_id == user.id, Task.cycle_group_id == group_id
        ).delete(synchronize_session=False)
    else:
        db.delete(task)
    db.commit()
    cleanup_orphan_tags(db, user.id)


def count_tasks(db: Session, user: User) -> dict:
    """Lightweight counters for MCP get_project_summary."""
    uid = user.id
    now = utcnow()
    return {
        "total": db.query(Task).filter(Task.user_id == uid).count(),
        "todo": db.query(Task).filter(Task.user_id == uid, Task.status == "todo").count(),
        "in_progress": db.query(Task).filter(
            Task.user_id == uid, Task.status == "in_progress"
        ).count(),
        "done": db.query(Task).filter(Task.user_id == uid, Task.status == "done").count(),
        "overdue": db.query(Task).filter(
            Task.user_id == uid, Task.deadline < now, Task.status != "done"
        ).count(),
    }
