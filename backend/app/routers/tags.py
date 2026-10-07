"""Tag management. A tag's color must not equal any list's color."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..board import PALETTE, list_colors
from ..db import get_db
from ..models import Tag, User

router = APIRouter(prefix="/tags", tags=["tags"])


def _tag_names(db: Session) -> set:
    return {r[0] for r in db.query(Tag.name).all()}


@router.get("", response_model=list[schemas.TagResponse])
def get_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Tag).order_by(Tag.name).all()


@router.post("", response_model=schemas.TagResponse, status_code=201)
def create_tag(
    data: schemas.TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название тега")
    if name in _tag_names(db):
        raise HTTPException(status_code=400, detail="Тег с таким именем уже есть")
    if data.color not in PALETTE:
        raise HTTPException(status_code=400, detail="Цвет должен быть из палитры")
    if data.color in list_colors(db):
        raise HTTPException(
            status_code=400,
            detail="Цвет тега не должен совпадать с цветом списка",
        )
    tag = Tag(name=name, color=data.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.put("/{tag_id}", response_model=schemas.TagResponse)
def update_tag(
    tag_id: int,
    data: schemas.TagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Тег не найден")
    if data.name is not None and data.name.strip():
        new = data.name.strip()
        if new != tag.name and new in _tag_names(db):
            raise HTTPException(status_code=400, detail="Имя тега занято")
        tag.name = new
    if data.color is not None:
        if data.color not in PALETTE:
            raise HTTPException(status_code=400, detail="Цвет должен быть из палитры")
        if data.color in list_colors(db):
            raise HTTPException(
                status_code=400,
                detail="Цвет тега не должен совпадать с цветом списка",
            )
        tag.color = data.color
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/{tag_id}")
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Тег не найден")
    # Detach the tag from tasks.
    from ..models import Task

    db.query(Task).filter(Task.tag == tag.name).update(
        {Task.tag: None}, synchronize_session=False
    )
    db.delete(tag)
    db.commit()
    return {"ok": True}
