"""Task summary statistics for the authenticated user."""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..db import get_db
from ..models import Task, User

router = APIRouter(prefix="/summary", tags=["summary"])


@router.get("", response_model=schemas.SummaryResponse)
def get_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid = current_user.id
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
    planned = db.query(Task).filter(
        Task.user_id == uid, Task.is_cyclic == True  # noqa: E712
    ).count()
    return {
        "total": total,
        "todo": todo,
        "in_progress": in_progress,
        "done": done,
        "overdue": overdue,
        "planned": planned,
    }
