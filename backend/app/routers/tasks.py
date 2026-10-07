"""Task CRUD endpoints, scoped to the authenticated user."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..db import get_db
from ..models import Task, User, task_dependencies

router = APIRouter(prefix="/tasks", tags=["tasks"])


# --- helpers for the blocking-task (dependencies) graph ---

def get_blocker_ids(db: Session, task_id: int) -> list[int]:
    """IDs of tasks that currently block this task."""
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
    """Replace the set of tasks that block `task_id`."""
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
        # Avoid a direct cycle: a task may not be blocked by one of the
        # tasks it itself blocks.
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


def _attach_blocking_state(db: Session, task: Task) -> Task:
    """Set transient `blocked_by` / `is_blocked` attributes for serialization."""
    ids = get_blocker_ids(db, task.id)
    task.blocked_by = ids
    task.is_blocked = compute_is_blocked(db, ids)
    return task


@router.get("", response_model=list[schemas.TaskResponse])
def list_tasks(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Task).filter(Task.user_id == current_user.id)
    if status:
        query = query.filter(Task.status == status)
    tasks = query.all()
    for t in tasks:
        _attach_blocking_state(db, t)
    return tasks


@router.post("", response_model=schemas.TaskResponse)
def create_task(
    task: schemas.TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = task.model_dump()
    blocked_by = data.pop("blocked_by", None)
    db_task = Task(user_id=current_user.id, **data)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    if blocked_by is not None:
        set_blockers(db, db_task.id, blocked_by, current_user.id)
        db.commit()
        db.refresh(db_task)
    return _attach_blocking_state(db, db_task)


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

    for key, value in update_data.items():
        setattr(db_task, key, value)

    # A task cannot be marked done while it still has incomplete blockers.
    if update_data.get("status") == "done":
        ids = get_blocker_ids(db, db_task.id)
        if compute_is_blocked(db, ids):
            raise HTTPException(
                status_code=400,
                detail="Невозможно выполнить задачу: есть незавершённые блокирующие задачи",
            )

    db.commit()
    if has_blocked_by:
        set_blockers(db, db_task.id, blocked_by, current_user.id)
        db.commit()
    db.refresh(db_task)
    return _attach_blocking_state(db, db_task)


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
    # Clean up any dependency edges that reference this task.
    db.execute(
        sa_delete(task_dependencies).where(
            (task_dependencies.c.blocker_id == task_id)
            | (task_dependencies.c.blocked_id == task_id)
        )
    )
    db.delete(db_task)
    db.commit()
    return {"ok": True}
