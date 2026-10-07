"""Task CRUD endpoints, scoped to the authenticated user."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..board import DONE_LIST, PALETTE, list_colors, list_names, status_for_list
from ..db import get_db
from ..models import Tag, Task, TaskList, User, task_dependencies, task_tags

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


def ensure_tags(db: Session, names) -> list:
    """Ensure Tag rows exist for each name (auto color, never colliding with
    list colors or other tags). Returns the list of Tag ORM objects."""
    if not names:
        return []
    used = list_colors(db) | {t.color for t in db.query(Tag).all()}
    result = []
    for name in names:
        name = (name or "").strip()
        if not name:
            continue
        tag = db.query(Tag).filter(Tag.name == name).first()
        if not tag:
            color = next((c for c in PALETTE if c not in used), "#64748b")
            tag = Tag(name=name, color=color)
            db.add(tag)
            db.commit()
            db.refresh(tag)
            used.add(color)
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
    db.execute(
        sa_delete(task_dependencies).where(
            (task_dependencies.c.blocker_id == task_id)
            | (task_dependencies.c.blocked_id == task_id)
        )
    )
    db.delete(db_task)
    db.commit()
    return {"ok": True}
