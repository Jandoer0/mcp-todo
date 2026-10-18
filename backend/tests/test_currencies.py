"""Мультивалютный бюджет: CRUD валют, привязка к задачам, пересчёт бюджета.

Изоляция строгая: валюты — на пользователя; чужая валюта недоступна (404).
Все финансовые расчёты — Decimal (конверсия на бэкенде, курс к базовой USD).
"""
import os
import tempfile

# Изолированная временная БД (env до импорта приложения, как в test_isolation)
_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/test_cur.db"
os.environ["STATIC_DIR"] = _TMP + "/static"

from fastapi.testclient import TestClient

from app.main import starlette_app

client = TestClient(starlette_app)


def _register(name):
    r = client.post("/api/auth/register", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _first_board(headers):
    r = client.get("/api/boards", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


def test_currency_crud_and_defaults():
    """Регистрация сидирует RUB/USD/EUR; курс обновляется; дубликат запрещён."""
    h = _register("cur_crud")
    r = client.get("/api/currencies", headers=h)
    assert r.status_code == 200
    codes = {c["code"] for c in r.json()}
    assert {"RUB", "USD", "EUR"} <= codes
    usd = next(c for c in r.json() if c["code"] == "USD")
    assert usd["rate"] == 1.0

    # create
    r = client.post(
        "/api/currencies",
        json={"code": "gbp", "name": "Фунт", "symbol": "£", "rate": 1.27},
        headers=h,
    )
    assert r.status_code == 201
    gbp = r.json()
    assert gbp["code"] == "GBP"  # код нормализуется в верхний регистр

    # duplicate code -> 400
    r = client.post(
        "/api/currencies", json={"code": "GBP", "name": "x"}, headers=h
    )
    assert r.status_code == 400

    # bad rate -> 422 (pydantic gt=0)
    r = client.post(
        "/api/currencies", json={"code": "BAD", "name": "x", "rate": -1}, headers=h
    )
    assert r.status_code == 422

    # update rate
    r = client.put(f"/api/currencies/{gbp['id']}", json={"rate": 1.3}, headers=h)
    assert r.status_code == 200
    assert r.json()["rate"] == 1.3

    # delete: задачи с валютой откатываются в базовую (NULL)
    r = client.delete(f"/api/currencies/{gbp['id']}", headers=h)
    assert r.status_code == 200
    r = client.get("/api/currencies", headers=h)
    assert "GBP" not in {c["code"] for c in r.json()}


def test_currencies_isolated():
    """Валюты другого пользователя недоступны (PUT/DELETE -> 404)."""
    ha = _register("cur_iso_a")
    hb = _register("cur_iso_b")
    r = client.get("/api/currencies", headers=ha)
    cur_id = r.json()[0]["id"]
    assert client.put(
        f"/api/currencies/{cur_id}", json={"rate": 2}, headers=hb
    ).status_code == 404
    assert client.delete(f"/api/currencies/{cur_id}", headers=hb).status_code == 404


def test_budget_multicurrency_conversion():
    """Суммы в разных валютах пересчитываются в валюту расчёта доски."""
    h = _register("cur_budget")
    bid = _first_board(h)

    # RUB -> USD по курсу 0.011: 10 000 RUB ≈ 110 USD
    currencies = client.get("/api/currencies", headers=h).json()
    rub = next(c for c in currencies if c["code"] == "RUB")
    eur = next(c for c in currencies if c["code"] == "EUR")
    client.put(f"/api/currencies/{rub['id']}", json={"rate": 0.011}, headers=h)

    # расход в рублях, доход в евро
    r = client.post(
        "/api/tasks",
        json={"title": "Билеты", "amount": -10000, "currency_id": rub["id"], "board_id": bid},
        headers=h,
    )
    assert r.status_code == 200
    r = client.post(
        "/api/tasks",
        json={"title": "Оплата", "amount": 100, "currency_id": eur["id"], "board_id": bid},
        headers=h,
    )
    assert r.status_code == 200

    # валюта расчёта доски — USD (по умолчанию)
    b = client.get(f"/api/boards/{bid}/budget", headers=h).json()
    assert b["report_currency"]["code"] == "USD"
    tickets = next(e for e in b["entries"] if e["title"] == "Билеты")
    assert tickets["currency_code"] == "RUB"
    assert abs(tickets["converted"] - (-110.0)) < 0.01
    assert abs(b["expense"] - (-110.0)) < 0.01
    # EUR: 100 * 1.1 = 110 USD
    assert abs(b["income"] - 110.0) < 0.01
    assert abs(b["total"]) < 0.01

    # смена валюты расчёта доски на RUB: -10 000 RUB и 100 EUR ≈ 10 000 RUB
    r = client.put(f"/api/boards/{bid}", json={"report_currency_id": rub["id"]}, headers=h)
    assert r.status_code == 200
    b = client.get(f"/api/boards/{bid}/budget", headers=h).json()
    assert b["report_currency"]["code"] == "RUB"
    assert abs(b["total"]) < 0.01  # 10 000 (EUR) − 10 000 (RUB)
    assert abs(b["income"] - 10000) < 0.01
    assert abs(b["expense"] + 10000) < 0.01

    # чужая валюта не может быть валютой расчёта (изоляция)
    hb = _register("cur_budget_b")
    bid_b = _first_board(hb)
    r = client.put(
        f"/api/boards/{bid_b}", json={"report_currency_id": rub["id"]}, headers=hb
    )
    assert r.status_code == 400
