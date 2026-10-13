"""Board CRUD: a user's workspaces. Tasks, lists and tags are strictly
board-scoped (spec §1). Max 20 boards per user."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..board import BOARD_PALETTE, MAX_BOARDS_PER_USER, ensure_default_lists
from ..db import get_db
from ..models import Board, Tag, Task, TaskList, User, Webhook

router = APIRouter(prefix="/boards", tags=["boards"])

MAX_NAME_LEN = 60


def get_own_board(db: Session, user: User, board_id: int) -> Board:
    """Return the board if it belongs to the user, else 404 (isolation)."""
    board = db.query(Board).filter(Board.id == board_id, Board.user_id == user.id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Доска не найдена")
    return board


@router.get("", response_model=list[schemas.BoardResponse])
def get_boards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Board)
        .filter(Board.user_id == current_user.id)
        .order_by(Board.position, Board.id)
        .all()
    )


@router.post("", response_model=schemas.BoardResponse, status_code=201)
def create_board(
    data: schemas.BoardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название доски")
    if len(name) > MAX_NAME_LEN:
        raise HTTPException(
            status_code=400, detail=f"Название доски не длиннее {MAX_NAME_LEN} символов"
        )
    if (
        db.query(Board)
        .filter(Board.user_id == current_user.id, Board.name == name)
        .first()
    ):
        raise HTTPException(status_code=400, detail="Доска с таким именем уже есть")
    owned = db.query(Board).filter(Board.user_id == current_user.id)
    if owned.count() >= MAX_BOARDS_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"Максимальное количество досок — {MAX_BOARDS_PER_USER}",
        )
    if data.color not in BOARD_PALETTE:
        raise HTTPException(status_code=400, detail="Цвет должен быть из палитры досок")
    pos = (
        db.query(Board)
        .filter(Board.user_id == current_user.id)
        .order_by(Board.position.desc())
        .first()
    )
    board = Board(
        user_id=current_user.id,
        name=name,
        description=data.description,
        color=data.color,
        position=(pos.position + 1) if pos else 0,
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    # A new board gets its own copy of the protected default lists.
    ensure_default_lists(db, current_user.id, board.id)
    return board


@router.put("/{board_id}", response_model=schemas.BoardResponse)
def update_board(
    board_id: int,
    data: schemas.BoardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = get_own_board(db, current_user, board_id)
    if data.name is not None and data.name.strip():
        name = data.name.strip()
        if len(name) > MAX_NAME_LEN:
            raise HTTPException(
                status_code=400,
                detail=f"Название доски не длиннее {MAX_NAME_LEN} символов",
            )
        if name != board.name and (
            db.query(Board)
            .filter(Board.user_id == current_user.id, Board.name == name)
            .first()
        ):
            raise HTTPException(status_code=400, detail="Доска с таким именем уже есть")
        board.name = name
    if data.description is not None:
        board.description = data.description
    if data.color is not None:
        if data.color not in BOARD_PALETTE:
            raise HTTPException(status_code=400, detail="Цвет должен быть из палитры досок")
        board.color = data.color
    if data.position is not None:
        board.position = data.position
    db.commit()
    db.refresh(board)
    return board


@router.delete("/{board_id}")
def delete_board(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = get_own_board(db, current_user, board_id)
    if db.query(Board).filter(Board.user_id == current_user.id).count() <= 1:
        raise HTTPException(status_code=400, detail="Нельзя удалить последнюю доску")
    # Cascade: a board owns its tasks, tags, lists and webhooks entirely.
    db.query(Webhook).filter(Webhook.board_id == board.id).delete()
    db.query(Task).filter(Task.board_id == board.id).delete(synchronize_session=False)
    db.query(Tag).filter(Tag.board_id == board.id).delete(synchronize_session=False)
    db.query(TaskList).filter(TaskList.board_id == board.id).delete(
        synchronize_session=False
    )
    db.delete(board)
    db.commit()
    return {"ok": True}
