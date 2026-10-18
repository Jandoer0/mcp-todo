"""Currency service: user-defined currencies and Decimal conversion.

All financial math uses ``decimal.Decimal`` (no float drift). Rates are
stored as floats in the DB (SQLite has no Decimal) but every conversion
goes through ``Decimal(str(rate))`` first.

Conversion model: ``rate`` = value of 1 unit of the currency in base units
(USD). So RUB with rate 0.011 means 10 000 RUB ≈ 110 USD.

    amount_in_base = Decimal(amount) * Decimal(str(rate))
    converted = amount_in_base / Decimal(str(target_rate))
"""
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session

from ..models import Board, Currency, User

# Money is displayed with two fractional digits (rounded half up).
_QUANT = Decimal("0.01")

# Currencies created for every user (params: code, name, symbol, rate).
DEFAULT_CURRENCIES = [
    ("RUB", "Рубли (РФ)", "₽", 0.011),
    ("USD", "Доллар (США)", "$", 1.0),
    ("EUR", "Евро (ЕС)", "€", 1.1),
]

MAX_CURRENCIES = 50


class CurrencyError(Exception):
    """Business-rule violation with a user-facing message."""

    def __init__(self, message: str):
        self.message = message


def ensure_default_currencies(db: Session, user_id: int) -> None:
    """Seed the three starter currencies (RUB/USD/EUR) for a user.
    Idempotent: called at registration and at startup."""
    existing = {
        c.code
        for c in db.query(Currency).filter(Currency.user_id == user_id).all()
    }
    added = False
    for code, name, symbol, rate in DEFAULT_CURRENCIES:
        if code in existing:
            continue
        db.add(
            Currency(user_id=user_id, code=code, name=name, symbol=symbol, rate=rate)
        )
        added = True
    if added:
        db.commit()


def list_currencies(db: Session, user: User) -> list[Currency]:
    """The user's currencies, base (USD) first then by code."""
    currencies = (
        db.query(Currency)
        .filter(Currency.user_id == user.id)
        .order_by(Currency.id)
        .all()
    )
    currencies.sort(key=lambda c: (c.code != "USD", c.code))
    return currencies


def get_own_currency(db: Session, user: User, currency_id: int) -> Currency | None:
    """The user's currency or None (foreign objects are treated as missing)."""
    return (
        db.query(Currency)
        .filter(Currency.id == currency_id, Currency.user_id == user.id)
        .first()
    )


def create_currency(db: Session, user: User, data: dict) -> Currency:
    """Create a currency; the code must be unique per user."""
    code = (data.get("code") or "").strip().upper()
    if not code or not code.isalnum() or len(code) > 10:
        raise CurrencyError("Код валюты: 1–10 латинских букв/цифр (например RUB)")
    if (
        db.query(Currency)
        .filter(Currency.user_id == user.id, Currency.code == code)
        .first()
    ):
        raise CurrencyError(f"Валюта с кодом {code} уже существует")
    if db.query(Currency).filter(Currency.user_id == user.id).count() >= MAX_CURRENCIES:
        raise CurrencyError(f"Максимальное количество валют — {MAX_CURRENCIES}")
    currency = Currency(
        user_id=user.id,
        code=code,
        name=(data.get("name") or "").strip() or code,
        symbol=(data.get("symbol") or "").strip() or code,
        rate=parse_rate(data.get("rate")),
    )
    db.add(currency)
    db.commit()
    db.refresh(currency)
    return currency


def update_currency(db: Session, user: User, currency_id: int, data: dict) -> Currency:
    """Partial update: name/symbol/rate; code may be renamed (kept unique)."""
    currency = get_own_currency(db, user, currency_id)
    if not currency:
        raise LookupError("Currency not found")
    if data.get("code") is not None:
        code = data["code"].strip().upper()
        if not code or not code.isalnum() or len(code) > 10:
            raise CurrencyError("Код валюты: 1–10 латинских букв/цифр (например RUB)")
        if code != currency.code and (
            db.query(Currency)
            .filter(Currency.user_id == user.id, Currency.code == code)
            .first()
        ):
            raise CurrencyError(f"Валюта с кодом {code} уже существует")
        currency.code = code
    if data.get("name") is not None:
        currency.name = data["name"].strip() or currency.name
    if data.get("symbol") is not None:
        currency.symbol = data["symbol"].strip() or currency.symbol
    if "rate" in data and data["rate"] is not None:
        currency.rate = parse_rate(data["rate"])
    db.commit()
    db.refresh(currency)
    return currency


def delete_currency(db: Session, user: User, currency_id: int) -> None:
    """Delete a currency. Tasks that used it fall back to the base currency
    (currency_id = NULL); a board report currency falls back likewise."""
    currency = get_own_currency(db, user, currency_id)
    if not currency:
        raise LookupError("Currency not found")
    db.query(Board).filter(
        Board.user_id == user.id, Board.report_currency_id == currency_id
    ).update({"report_currency_id": None}, synchronize_session=False)
    from ..models import Task

    db.query(Task).filter(
        Task.user_id == user.id, Task.currency_id == currency_id
    ).update({"currency_id": None}, synchronize_session=False)
    db.delete(currency)
    db.commit()


def parse_rate(value) -> float | None:
    """Validate a rate: positive finite number, reasonable magnitude."""
    try:
        rate = float(value)
    except (TypeError, ValueError):
        raise CurrencyError("Курс должен быть числом больше нуля") from None
    if not (rate > 0) or rate != rate or rate in (float("inf"), float("-inf")):
        raise CurrencyError("Курс должен быть числом больше нуля")
    if rate > 1e9:
        raise CurrencyError("Слишком большой курс (максимум 1e9)")
    return rate


def rates_map(db: Session, user_id: int) -> dict[int, float]:
    """{currency_id: rate} for the user's currencies."""
    return {
        c.id: float(c.rate) if c.rate else None
        for c in db.query(Currency).filter(Currency.user_id == user_id).all()
    }


def convert_amount(amount: float, src_rate: float | None, dst_rate: float | None) -> Decimal | None:
    """Convert a signed amount between two currencies (Decimal).

    Returns None when either rate is missing — the caller (UI) shows a
    "обновите параметры валют" warning instead of a wrong number.
    """
    if amount is None:
        return None
    if not src_rate or not dst_rate:
        return None
    value = Decimal(str(amount)) * Decimal(str(src_rate)) / Decimal(str(dst_rate))
    return value.quantize(_QUANT, rounding=ROUND_HALF_UP)
