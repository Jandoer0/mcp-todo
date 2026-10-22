"""§5.2: денежные суммы хранятся в минорных единицах (копейки, INTEGER),
наружу API отдаёт основные единицы. Run: cd backend && python3 -m pytest tests/test_money.py -q"""
import os
import tempfile

_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/test_money.db"
os.environ["STATIC_DIR"] = _TMP + "/static"

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import starlette_app

client = TestClient(starlette_app)


def _register(name):
    r = client.post("/api/auth/register", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _first_board(headers):
    return client.get("/api/boards", headers=headers).json()[0]["id"]


def _raw(query, **params):
    """Сырой SQL через общий engine приложения (общий прогон pytest)."""
    from app.db import SessionLocal

    with SessionLocal() as db:
        return db.execute(text(query), params).fetchall()


def test_amount_column_is_integer_minor_units():
    """Колонка amount — INTEGER (копейки), конвертация точная."""
    h = _register("money_storage")
    b = _first_board(h)

    for amount in (1234.56, -7.5, 0, 10000):
        r = client.post(
            "/api/tasks",
            headers=h,
            json={"title": f"t{amount}", "board_id": b, "amount": amount},
        )
        assert r.status_code == 200, r.text
        # Наружу — основные единицы без потери точности.
        assert r.json()["amount"] == amount

    rows = {
        title: (amount, typeof_amount)
        for title, amount, typeof_amount in _raw(
            "SELECT title, amount, typeof(amount) FROM tasks WHERE user_id = :u",
            u=_user_id(h),
        )
    }
    assert rows["t1234.56"] == (123456, "integer")
    assert rows["t-7.5"] == (-750, "integer")
    assert rows["t0"] == (0, "integer")
    assert rows["t10000"] == (1000000, "integer")

    # Тип колонки заявлен INTEGER — иначе SQLite снова начнёт хранить REAL.
    col_type = {
        r[2] for r in _raw("PRAGMA table_info(tasks)") if r[1] == "amount"
    }
    assert col_type == {"INTEGER"}


def _user_id(headers):
    return client.get("/api/auth/me", headers=headers).json()["id"]


def test_update_roundtrips_minor_units():
    """Обновление суммы через PUT: копейки в БД, основные единицы в API."""
    h = _register("money_update")
    b = _first_board(h)
    r = client.post(
        "/api/tasks",
        headers=h,
        json={"title": "upd", "board_id": b, "amount": 1.11},
    )
    tid = r.json()["id"]

    r = client.put(f"/api/tasks/{tid}", headers=h, json={"amount": 2.02})
    assert r.status_code == 200, r.text
    assert r.json()["amount"] == 2.02

    stored = _raw("SELECT amount FROM tasks WHERE id = :id", id=tid)[0][0]
    assert stored == 202


def test_cycle_history_amounts_roundtrip():
    """Факт итерации: major в API → копейки в БД → major в истории."""
    h = _register("money_cycle")
    b = _first_board(h)
    r = client.post(
        "/api/tasks",
        headers=h,
        json={
            "title": "Аренда",
            "board_id": b,
            "amount": -500,
            "is_cyclic": True,
            "cycle_period": "monthly",
            "cycle_interval": 1,
        },
    )
    tid = r.json()["id"]

    r = client.post(
        f"/api/tasks/{tid}/cycle/complete",
        headers=h,
        json={"actual_date": "2026-01-09T09:00:00", "actual_amount": -450.5},
    )
    assert r.status_code == 200, r.text

    row = _raw(
        "SELECT planned_amount, actual_amount, typeof(actual_amount) "
        "FROM task_cycle_logs WHERE action='completed' AND user_id = :u "
        "ORDER BY id DESC LIMIT 1",
        u=_user_id(h),
    )[0]
    assert row[0] == -50000  # план — плановая сумма задачи в копейках
    assert row[1] == -45050 and row[2] == "integer"

    hist = client.get(
        f"/api/tasks/{r.json()['id']}/cycle/history", headers=h
    ).json()
    completed = [lg for lg in hist if lg["action"] == "completed"]
    assert completed and completed[0]["actual_amount"] == -450.5
