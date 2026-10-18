"""Currency CRUD (параметры валют): per-user currencies with rates to the
base unit (USD). Strictly isolated: every query filters by current_user.id."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..db import get_db
from ..models import User
from ..services import currency_service
from ..services.currency_service import CurrencyError

router = APIRouter(prefix="/currencies", tags=["currencies"])


@router.get("", response_model=list[schemas.CurrencyResponse])
def get_currencies(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return currency_service.list_currencies(db, current_user)


@router.post("", response_model=schemas.CurrencyResponse, status_code=201)
def create_currency(
    data: schemas.CurrencyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return currency_service.create_currency(db, current_user, data.model_dump())
    except CurrencyError as e:
        raise HTTPException(status_code=400, detail=e.message) from None


@router.post("/reorder")
def reorder_currencies(
    data: schemas.CurrencyReorder,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Сохранить новый порядок валют (полный список id). Первая валюта
    становится валютой по умолчанию во всех выпадающих списках."""
    currency_service.reorder_currencies(db, current_user, data.ids)
    return {"ok": True}


@router.put("/{currency_id}", response_model=schemas.CurrencyResponse)
def update_currency(
    currency_id: int,
    data: schemas.CurrencyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return currency_service.update_currency(
            db, current_user, currency_id, data.model_dump(exclude_unset=True)
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Валюта не найдена") from None
    except CurrencyError as e:
        raise HTTPException(status_code=400, detail=e.message) from None


@router.delete("/{currency_id}")
def delete_currency(
    currency_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        currency_service.delete_currency(db, current_user, currency_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Валюта не найдена") from None
    return {"ok": True}
