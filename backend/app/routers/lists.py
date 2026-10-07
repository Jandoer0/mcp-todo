"""Board list management: default + user-defined lists (columns of the board)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..board import (
    PALETTE,
    PROTECTED_LIST_NAMES,
    list_colors,
    list_names,
)
from ..db import get_db
from ..models import Task, TaskList, User

router = APIRouter(prefix="/lists", tags=["lists"])


@router.get("", response_model=list[schemas.TaskListResponse])
def get_lists(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(TaskList).order_by(TaskList.position).all()


@router.post("", response_model=schemas.TaskListResponse, status_code=201)
def create_list(
    data: schemas.TaskListCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название списка")
    if name in PROTECTED_LIST_NAMES:
        raise HTTPException(
            status_code=400,
            detail="Нельзя создать список с зарезервированным именем",
        )
    if name in list_names(db):
        raise HTTPException(status_code=400, detail="Список с таким именем уже есть")
    if data.color not in PALETTE:
        raise HTTPException(status_code=400, detail="Цвет должен быть из палитры")
    pos = data.position
    if pos is None:
        pos = (db.query(func.max(TaskList.position)).scalar() or 0) + 1
    lst = TaskList(name=name, color=data.color, position=pos, is_default=False)
    db.add(lst)
    db.commit()
    db.refresh(lst)
    return lst


@router.put("/{list_id}", response_model=schemas.TaskListResponse)
def update_list(
    list_id: int,
    data: schemas.TaskListUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lst = db.get(TaskList, list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="Список не найден")

    if lst.is_default:
        # Protected lists can change color/order but not name.
        if data.name is not None and data.name.strip() != lst.name:
            raise HTTPException(
                status_code=400, detail="Зарезервированный список нельзя переименовать"
            )
    elif data.name is not None and data.name.strip():
        new = data.name.strip()
        if new != lst.name and (new in PROTECTED_LIST_NAMES or new in list_names(db)):
            raise HTTPException(status_code=400, detail="Имя списка занято")
        lst.name = new

    if data.color is not None:
        if data.color not in PALETTE:
            raise HTTPException(status_code=400, detail="Цвет должен быть из палитры")
        lst.color = data.color
    if data.position is not None:
        lst.position = data.position

    db.commit()
    db.refresh(lst)
    return lst


@router.delete("/{list_id}")
def delete_list(
    list_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lst = db.get(TaskList, list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="Список не найден")
    if lst.is_default:
        raise HTTPException(
            status_code=400, detail="Зарезервированный список нельзя удалить"
        )
    # Reassign affected tasks to the default "not started" list.
    db.query(Task).filter(Task.list == lst.name).update(
        {Task.list: "Не начато"}, synchronize_session=False
    )
    db.delete(lst)
    db.commit()
    return {"ok": True}
