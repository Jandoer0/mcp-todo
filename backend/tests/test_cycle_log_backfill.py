"""Бэкфилл привязки логов циклов к доске (main._backfill_cycle_log_boards).

Старые записи истории (записанные до появления board_id у task_cycle_logs,
например платёж «Рассрочка OZON» от 19.10.2026) имеют board_id = NULL и не
попадали на график доски. Проверяем, что миграция восстанавливает привязку
из живой задачи той же цепочки, а график начинает видеть факт.
Run: cd backend && python3 -m pytest tests/test_cycle_log_backfill.py -q"""
import os
import tempfile

_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/backfill.db"
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
    return client.get("/api/boards", headers=headers).json()[0]["id"]


def test_orphan_cycle_log_backfills_to_live_task_board():
    """Симулируем «старую» запись: завершаем итерацию и стираем board_id,
    затем повторно запускаем миграцию — привязка восстанавливается и факт
    появляется в /cashflow доски."""
    from sqlalchemy import text

    from app.db import SessionLocal

    h = _register("backfill_user")
    bid = _first_board(h)
    t = client.post(
        "/api/tasks",
        headers=h,
        json={
            "title": "Рассрочка OZON",
            "is_cyclic": True,
            "cycle_period": "monthly",
            "cycle_interval": 1,
            "amount": -4000,
            "deadline": "2026-11-23T12:00:00",
        },
    ).json()
    client.post(
        f"/api/tasks/{t['id']}/cycle/complete",
        headers=h,
        json={"actual_date": "2026-10-19T12:00:00", "actual_amount": -4000},
    ).json()

    # Имитируемlegacy-запись: доска не указана (как в проде до миграции)
    with SessionLocal() as db:
        db.execute(text("UPDATE task_cycle_logs SET board_id = NULL"))
        db.commit()

    # Повторный запуск миграции (как при рестарте контейнера)
    from app.main import _backfill_cycle_log_boards

    _backfill_cycle_log_boards()

    with SessionLocal() as db:
        bound = db.execute(
            text("SELECT board_id FROM task_cycle_logs WHERE cycle_group_id = :g"),
            {"g": t["cycle_group_id"]},
        ).scalar()
    assert bound == bid, "лог должен привязаться к доске живой задачи цепочки"

    # График доски теперь видит факт -4000 от 19.10.2026
    cf = client.get(f"/api/boards/{bid}/cashflow", headers=h).json()
    facts = [e for e in cf["events"] if e.get("actual")]
    assert facts, "факт-событие должно попасть в график доски"
    assert facts[0]["start"] == "2026-10-19"
    assert facts[0]["converted"] == -4000


def test_orphan_log_without_live_task_uses_default_board():
    """Если цепочка уже прекращена (задач нет) — лог привязывается к первой
    доске владельца, а не остаётся сиротой."""
    import uuid

    from sqlalchemy import text

    from app.db import SessionLocal
    from app.models import TaskCycleLog

    h = _register("backfill_orphan")
    bid = _first_board(h)
    with SessionLocal() as db:
        db.add(
            TaskCycleLog(
                user_id=db.query(1).scalar(),  # placeholder, ниже перезапишем
                cycle_group_id=uuid.uuid4().hex,
                task_title="Оставшийся лог",
                action="completed",
                actual_amount=-100,
                actual_date=None,
            )
        )
        db.commit()
        # выставляем владельца напрямую (user_id обязателен)
        db.execute(
            text(
                "UPDATE task_cycle_logs SET user_id = ("
                "  SELECT id FROM users WHERE username = 'backfill_orphan'), "
                "actual_date = '2026-10-19 12:00:00' "
                "WHERE task_title = 'Оставшийся лог'"
            )
        )
        db.commit()

    from app.main import _backfill_cycle_log_boards

    _backfill_cycle_log_boards()

    with SessionLocal() as db:
        bound = db.execute(
            text(
                "SELECT board_id FROM task_cycle_logs WHERE task_title = 'Оставшийся лог'"
            )
        ).scalar()
    assert bound == bid, "сирота должна привязаться к дефолтной доске владельца"
