"""Task CRUD endpoints, scoped to the authenticated user."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..board import DONE_LIST, PALETTE, list_colors, list_names, status_for_list
from ..db import get_db
from ..models import Tag, Task, TaskCycleLog, TaskList, User, task_dependencies, task_tags
from .tags import cleanup_orphan_tags

router = APIRouter(prefix="/tasks", tags=["tasks"])


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


def tag_palette(db) -> list:
    """Colors available for tags: the full PALETTE minus colors taken by lists.
    Per AGENTS.md there are 18 presets; when they run out, colors repeat."""
    used_by_lists = list_colors(db)
    return [c for c in PALETTE if c not in used_by_lists]


def _pick_tag_color(db) -> str:
    """Pick a color for a new tag: first unused one, otherwise cycle deterministically
    by the count of existing tags (colors repeat when the palette is exhausted)."""
    avail = tag_palette(db)
    if not avail:
        avail = list(PALETTE)
    used = {t.color for t in db.query(Tag).all()}
    color = next((c for c in avail if c not in used), None)
    if color is None:
        count = db.query(Tag).count()
        color = avail[count % len(avail)]
    return color


def repair_tag_colors(db) -> int:
    """Reassign colors to tags that ended up with a color not allowed for tags
    (e.g. the gray fallback colliding with the 'Не начато' list color)."""
    avail = tag_palette(db)
    if not avail:
        avail = list(PALETTE)
    allowed = set(avail)
    used = {t.color for t in db.query(Tag).all() if t.color in allowed}
    fixed = 0
    for tag in db.query(Tag).all():
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


def ensure_tags(db: Session, names) -> list:
    """Ensure Tag rows exist for each name (auto color, never colliding with
    list colors; colors repeat cyclically when the palette is exhausted).
    Returns the list of Tag ORM objects."""
    if not names:
        return []

    result = []
    for name in names:
        name = (name or "").strip()
        if not name:
            continue
        tag = db.query(Tag).filter(Tag.name == name).first()
        if not tag:
            tag = Tag(name=name, color=_pick_tag_color(db))
            db.add(tag)
            db.commit()
            db.refresh(tag)
        result.append(tag)
    return result


def _attach_state(db: Session, task: Task) -> Task:
    """Set transient attributes used for serialization."""
    ids = get_blocker_ids(db, task.id)
    task.blocked_by = ids
    task.is_blocked = compute_is_blocked(db, ids)
    tag_rows = (
        db.query(Tag)
        .join(task_tags, Tag.id == task_tags.c.tag_id)
        .filter(task_tags.c.task_id == task.id)
        .all()
    )
    task.tags = tag_rows
    return task


def _resolve_list(db: Session, name: Optional[str]) -> str:
    """Return a valid list name, falling back to the default 'not started' list."""
    if name and name in list_names(db):
        return name
    return "Не начато"


# ---------------- Cyclic tasks ----------------

import uuid as _uuid
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
        list=_resolve_list(db, "Не начато"),
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


@router.post("/bulk", response_model=schemas.BulkUpdateResponse)
def bulk_update_tasks(
    bulk_data: schemas.TaskBulkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updated = 0
    created = 0
    errors = []

    for i, task_data in enumerate(bulk_data.tasks):
        try:
            task_id = task_data.get("id")
            if task_id:
                # Update existing
                db_task = db.query(Task).filter(
                    Task.id == task_id, Task.user_id == current_user.id
                ).first()
                if not db_task:
                    raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
                
                # Update fields (excluding ID)
                update_fields = {k: v for k, v in task_data.items() if k != "id"}
                
                # Resolve list and status
                if "list" in update_fields:
                    list_name = _resolve_list(db, update_fields["list"])
                    update_fields["list"] = list_name
                    update_fields["status"] = status_for_list(list_name)
                
                # Handle tags
                tag_names = update_fields.pop("tags", None)
                for key, value in update_fields.items():
                    setattr(db_task, key, value)
                
                if tag_names is not None:
                    db_task.tags = ensure_tags(db, tag_names)
                
                db.commit()
                updated += 1
            else:
                # Create new
                data = task_data.copy()
                list_name = _resolve_list(db, data.get("list"))
                data["list"] = list_name
                data["status"] = status_for_list(list_name)
                
                tag_names = data.pop("tags", None)
                db_task = Task(user_id=current_user.id, **data)
                if tag_names is not None:
                    db_task.tags = ensure_tags(db, tag_names)
                
                db.add(db_task)
                db.commit()
                created += 1
        except Exception as e:
            errors.append({"index": i, "error": str(e)})
    
    return {"updated": updated, "created": created, "errors": errors}

@router.get("", response_model=list[schemas.TaskResponse])
def list_tasks(
    status: Optional[str] = None,
    list: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Task).filter(Task.user_id == current_user.id)
    if status:
        query = query.filter(Task.status == status)
    if list:
        query = query.filter(Task.list == list)
    tasks = query.all()
    for t in tasks:
        _attach_state(db, t)
    # Smart visibility: dormant cyclic tasks are filtered out server-side.
    now = datetime.utcnow()
    tasks = [t for t in tasks if is_cycle_visible(t, now)]
    return tasks


@router.post("", response_model=schemas.TaskResponse)
def create_task(
    task: schemas.TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = task.model_dump()
    blocked_by = data.pop("blocked_by", None)
    tag_names = data.pop("tags", None)
    list_name = _resolve_list(db, data.get("list"))
    data["list"] = list_name
    data["status"] = status_for_list(list_name)
    # A task cannot be created already "Готово" while still blocked.
    if data["status"] == "done" and compute_is_blocked(db, blocked_by or []):
        raise HTTPException(
            status_code=400,
            detail="Невозможно выполнить задачу: есть незавершённые блокирующие задачи",
        )
    db_task = Task(user_id=current_user.id, **data)
    if tag_names is not None:
        db_task.tags = ensure_tags(db, tag_names)
    # A new cyclic task gets a fresh iteration-chain id.
    if db_task.is_cyclic:
        if db_task.cycle_period not in CYCLE_PERIODS:
            db_task.cycle_period = "monthly"
        if not db_task.cycle_group_id:
            db_task.cycle_group_id = _uuid.uuid4().hex
        db_task.cycle_interval = max(1, db_task.cycle_interval or 1)
        db_task.reminder_days = max(0, db_task.reminder_days or 0)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    if blocked_by is not None:
        set_blockers(db, db_task.id, blocked_by, current_user.id)
        db.commit()
        db.refresh(db_task)
    return _attach_state(db, db_task)


@router.put("/{task_id}", response_model=schemas.TaskResponse)
def update_task(
    task_id: int,
    task: schemas.TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == current_user.id)
        .first()
    )
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = task.model_dump(exclude_unset=True)
    blocked_by = update_data.pop("blocked_by", None)
    has_blocked_by = "blocked_by" in task.model_fields_set
    tag_names = update_data.pop("tags", None)
    has_tags = "tags" in task.model_fields_set

    # Resolve the new list name (if provided) and derive the resulting status.
    if "list" in update_data:
        list_name = _resolve_list(db, update_data["list"])
        update_data["list"] = list_name
        update_data["status"] = status_for_list(list_name)

    for key, value in update_data.items():
        setattr(db_task, key, value)

    if has_tags:
        db_task.tags = ensure_tags(db, tag_names or [])
        cleanup_orphan_tags(db)

    # A task cannot be marked done (moved to "Готово") while still blocked.
    if db_task.status == "done":
        ids = blocked_by if has_blocked_by else get_blocker_ids(db, db_task.id)
        if compute_is_blocked(db, ids or []):
            raise HTTPException(
                status_code=400,
                detail="Невозможно выполнить задачу: есть незавершённые блокирующие задачи",
            )

    db.commit()
    if has_blocked_by:
        set_blockers(db, db_task.id, blocked_by, current_user.id)
        db.commit()
    db.refresh(db_task)

    # Cyclic task completed: log the iteration and spawn the next one.
    if db_task.is_cyclic and db_task.status == "done":
        return _attach_state(db, regenerate_cycle(db, db_task))

    return _attach_state(db, db_task)


@router.delete("/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == current_user.id)
        .first()
    )
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Deleting a cyclic task removes the whole iteration chain.
    group_id = db_task.cycle_group_id if db_task.is_cyclic else None
    chain_ids = []
    if group_id:
        chain = (
            db.query(Task)
            .filter(Task.user_id == current_user.id, Task.cycle_group_id == group_id)
            .all()
        )
        chain_ids = [t.id for t in chain]
    else:
        chain_ids = [task_id]

    db.execute(
        sa_delete(task_dependencies).where(
            (task_dependencies.c.blocker_id.in_(chain_ids))
            | (task_dependencies.c.blocked_id.in_(chain_ids))
        )
    )
    if group_id:
        db.query(Task).filter(
            Task.user_id == current_user.id, Task.cycle_group_id == group_id
        ).delete(synchronize_session=False)
    else:
        db.delete(db_task)
    db.commit()
    cleanup_orphan_tags(db)
    return {"ok": True}


@router.post("/{task_id}/cycle/skip", response_model=schemas.TaskResponse)
def cycle_skip(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Silently shift the deadline of a cyclic task to the next cycle."""
    db_task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == current_user.id)
        .first()
    )
    if not db_task or not db_task.is_cyclic:
        raise HTTPException(status_code=404, detail="Cyclic task not found")
    if not db_task.deadline:
        raise HTTPException(status_code=400, detail="У задачи нет дедлайна для сдвига")
    db_task.deadline = advance_deadline(
        db_task.deadline, db_task.cycle_period, db_task.cycle_interval
    )
    db.commit()
    db.refresh(db_task)
    return _attach_state(db, db_task)


@router.post("/{task_id}/cycle/stop", response_model=schemas.TaskResponse)
def cycle_stop(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Break the cycle: the task becomes a regular one and is logged."""
    db_task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == current_user.id)
        .first()
    )
    if not db_task or not db_task.is_cyclic:
        raise HTTPException(status_code=404, detail="Cyclic task not found")
    db_task.is_cyclic = False
    cycle_log(db, db_task.user_id, db_task.cycle_group_id, db_task, "stopped")
    db.commit()
    db.refresh(db_task)
    return _attach_state(db, db_task)


@router.get("/{task_id}/cycle/history", response_model=list[schemas.CycleLogResponse])
def cycle_history(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """History of all iterations of the cyclic chain this task belongs to."""
    db_task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == current_user.id)
        .first()
    )
    if not db_task or not db_task.cycle_group_id:
        return []
    return (
        db.query(TaskCycleLog)
        .filter(
            TaskCycleLog.user_id == current_user.id,
            TaskCycleLog.cycle_group_id == db_task.cycle_group_id,
        )
        .order_by(TaskCycleLog.logged_at.desc())
        .all()
    )
