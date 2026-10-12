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
from .tags import cleanup_orphan_tags  # noqa: F401
from ..services import task_service
from ..services.task_service import (  # noqa: F401  (re-exported helpers)
    CYCLE_PERIODS,
    TaskError,
    _attach_state,
    _attach_state_many,
    advance_deadline,
    cleanup_orphan_tags as _svc_cleanup,
    compute_is_blocked,
    cycle_log,
    ensure_tags,
    get_blocker_ids,
    is_cycle_visible,
    regenerate_cycle,
    set_blockers,
)
from ..services.task_service import tag_palette, repair_tag_colors  # noqa: F401

router = APIRouter(prefix="/tasks", tags=["tasks"])


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
                
                # Update fields (excluding ID and protected columns:
                # user_id must never be settable via the API — otherwise a
                # user could move their task into another user's account).
                update_fields = {
                    k: v for k, v in task_data.items() if k not in ("id", "user_id")
                }
                
                # Resolve list and status
                if "list" in update_fields:
                    list_name = _resolve_list(db, update_fields["list"], current_user.id)
                    update_fields["list"] = list_name
                    update_fields["status"] = status_for_list(list_name)
                
                # Handle tags
                tag_names = update_fields.pop("tags", None)
                for key, value in update_fields.items():
                    setattr(db_task, key, value)
                
                if tag_names is not None:
                    db_task.tags = ensure_tags(db, tag_names, current_user.id)
                
                db.commit()
                updated += 1
            else:
                # Create new
                data = task_data.copy()
                list_name = _resolve_list(db, data.get("list"), current_user.id)
                data["list"] = list_name
                data["status"] = status_for_list(list_name)
                
                tag_names = data.pop("tags", None)
                data.pop("id", None)
                data.pop("user_id", None)  # protected: always the caller
                db_task = Task(user_id=current_user.id, **data)
                if tag_names is not None:
                    db_task.tags = ensure_tags(db, tag_names, current_user.id)
                
                db.add(db_task)
                db.commit()
                created += 1
        except HTTPException as e:
            errors.append({"index": i, "error": e.detail})
        except Exception:
            # Never leak internals (SQL/column names) to the client.
            errors.append({"index": i, "error": "Ошибка обработки элемента"})

    # Tag sets may have been replaced above — drop tags left without tasks.
    cleanup_orphan_tags(db, current_user.id)

    return {"updated": updated, "created": created, "errors": errors}

@router.get("", response_model=list[schemas.TaskResponse])
def list_tasks(
    status: Optional[str] = None,
    list: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tasks = task_service.list_tasks(db, current_user, status=status, list_name=list)
    return tasks


@router.post("", response_model=schemas.TaskResponse)
def create_task(
    task: schemas.TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        db_task = task_service.create_task(db, current_user, task.model_dump())
    except TaskError as e:
        raise HTTPException(status_code=400, detail=e.message)
    return _attach_state(db, db_task)


@router.put("/{task_id}", response_model=schemas.TaskResponse)
def update_task(
    task_id: int,
    task: schemas.TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        db_task = task_service.update_task(
            db, current_user, task_id, task.model_dump(exclude_unset=True)
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Task not found")
    except TaskError as e:
        raise HTTPException(status_code=400, detail=e.message)
    return _attach_state(db, db_task)


@router.delete("/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        task_service.delete_task(db, current_user, task_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Task not found")
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
