"""Реформа циклических задач (ТЗ): системный список «Регулярные», жёсткая
связь «циклическая ⇔ Регулярные», учёт «План vs Факт» (история итераций),
базовый слой в бюджете и факт-события на графике. Run: cd backend && python3 -m pytest tests/test_regular.py -q"""
import os
import tempfile

_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/test_regular.db"
os.environ["STATIC_DIR"] = _TMP + "/static"

from fastapi.testclient import TestClient

from app.main import starlette_app

client = TestClient(starlette_app)

# Полный набор тестов делает больше регистраций, чем часовой лимит на IP
# (30/час): реформа добавила свои, из-за чего алфавитный порядок файлов мог
# уронить чужие 422-тесты на 429. Для тестовой сессии лимит снят.
_r = client.post("/api/auth/register", json={"username": "limiter_setup", "password": "secret123"})
assert _r.status_code == 200, _r.text
_l = client.post("/api/auth/login", json={"username": "limiter_setup", "password": "secret123"})
assert _l.status_code == 200, _l.text
from app.db import SessionLocal as _SessionLocal
from app.site_settings import set_setting as _set_setting

_s = _SessionLocal()
try:
    _set_setting(_s, "register_rate_limit_per_hour", "1000000")
finally:
    _s.close()


def _register(name):
    r = client.post("/api/auth/register", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _first_board(headers):
    return client.get("/api/boards", headers=headers).json()[0]["id"]


def _cyclic_payload(**kw):
    data = {
        "title": "Аренда квартиры",
        "is_cyclic": True,
        "cycle_period": "monthly",
        "cycle_interval": 1,
        "amount": -500,
        "deadline": "2026-01-10T12:00:00",
    }
    data.update(kw)
    return data


# ---------------- Список «Регулярные» ----------------

def test_regular_list_seeded():
    h = _register("reg_seed")
    bid = _first_board(h)
    names = {l["name"]: l for l in client.get("/api/lists", params={"board_id": bid}, headers=h).json()}
    assert "Регулярные" in names
    assert names["Регулярные"]["kind"] == "regular"


def test_regular_list_is_protected():
    h = _register("reg_prot")
    bid = _first_board(h)
    lst = [l for l in client.get("/api/lists", params={"board_id": bid}, headers=h).json() if l["name"] == "Регулярные"][0]
    # удалить нельзя
    assert client.delete(f"/api/lists/{bid}/{lst['id']}", headers=h).status_code == 400
    # переименовать нельзя
    assert client.put(f"/api/lists/{bid}/{lst['id']}", json={"name": "Мои"}, headers=h).status_code == 400
    # сменить статус нельзя
    assert client.put(f"/api/lists/{bid}/{lst['id']}", json={"kind": "done"}, headers=h).status_code == 400
    # создать список с тем же именем нельзя
    assert client.post("/api/lists", params={"board_id": bid}, json={"name": "Регулярные", "color": "#ef4444"}, headers=h).status_code == 400


# ---------------- Инвариант «циклическая ⇔ Регулярные» ----------------

def test_cyclic_task_lands_in_regular_list():
    h = _register("reg_cycl")
    bid = _first_board(h)
    t = client.post("/api/tasks", headers=h, json=_cyclic_payload(list="Не начато")).json()
    assert t["is_cyclic"] and t["list"] == "Регулярные"


def test_regular_task_cannot_enter_regular_list():
    h = _register("reg_norm")
    bid = _first_board(h)
    # при создании
    t = client.post("/api/tasks", headers=h, json={"title": "Разовое", "list": "Регулярные"}).json()
    assert not t["is_cyclic"] and t["list"] != "Регулярные"
    # и при обновлении
    t2 = client.post("/api/tasks", headers=h, json={"title": "Разовое 2"}).json()
    t2 = client.put(f"/api/tasks/{t2['id']}", headers=h, json={"list": "Регулярные"}).json()
    assert t2["list"] != "Регулярные"


def test_cyclic_task_cannot_leave_regular_list():
    h = _register("reg_stay")
    bid = _first_board(h)
    t = client.post("/api/tasks", headers=h, json=_cyclic_payload()).json()
    t = client.put(f"/api/tasks/{t['id']}", headers=h, json={"list": "В работе"}).json()
    assert t["is_cyclic"] and t["list"] == "Регулярные"
    # даже одновременная попытка смены флага и списка: флаг снимается —
    # инвариант уводит задачу из «Регулярных»
    t = client.put(f"/api/tasks/{t['id']}", headers=h, json={"is_cyclic": False, "list": "В работе"}).json()
    assert not t["is_cyclic"] and t["list"] == "В работе"
    # повторное включение возвращает в «Регулярные»
    t = client.put(f"/api/tasks/{t['id']}", headers=h, json={"is_cyclic": True, "list": "В работе"}).json()
    assert t["is_cyclic"] and t["list"] == "Регулярные"


def test_bulk_respects_regular_invariant():
    h = _register("reg_bulk")
    bid = _first_board(h)
    r = client.post(
        "/api/tasks/bulk",
        json={"tasks": [
            {"title": "Связь", "is_cyclic": True, "cycle_period": "weekly", "list": "В работе"},
            {"title": "Обычная", "list": "Регулярные"},
        ]},
        headers=h,
    )
    assert r.json()["errors"] == []
    tasks = {t["title"]: t for t in client.get("/api/tasks", headers=h).json()}
    assert tasks["Связь"]["list"] == "Регулярные"
    assert tasks["Обычная"]["list"] != "Регулярные"


# ---------------- План vs Факт ----------------

def test_cycle_complete_records_actuals():
    h = _register("reg_fact")
    bid = _first_board(h)
    t = client.post("/api/tasks", headers=h, json=_cyclic_payload(amount=-500)).json()
    r = client.post(
        f"/api/tasks/{t['id']}/cycle/complete",
        headers=h,
        json={"actual_date": "2026-01-12T15:00:00", "actual_amount": -530.5},
    )
    assert r.status_code == 200, r.text
    nxt = r.json()
    # следующая итерация — в «Регулярные», с плановой суммой
    assert nxt["is_cyclic"] and nxt["list"] == "Регулярные" and nxt["amount"] == -500
    # старая итерация удалена (заменена следующей)
    ids = [x["id"] for x in client.get("/api/tasks", headers=h).json()]
    assert t["id"] not in ids
    # история итераций: факт записан
    hist = client.get(f"/api/tasks/{nxt['id']}/cycle/history", headers=h).json()
    assert len(hist) == 1
    row = hist[0]
    assert row["action"] == "completed"
    assert row["actual_amount"] == -530.5
    assert row["actual_date"].startswith("2026-01-12")
    assert row["planned_amount"] == -500


def test_cycle_complete_defaults():
    """Без факта: дата = сейчас, сумма = плановая."""
    h = _register("reg_def")
    bid = _first_board(h)
    t = client.post("/api/tasks", headers=h, json=_cyclic_payload(amount=-500)).json()
    r = client.post(f"/api/tasks/{t['id']}/cycle/complete", headers=h, json={})
    assert r.status_code == 200
    nxt = r.json()
    hist = client.get(f"/api/tasks/{nxt['id']}/cycle/history", headers=h).json()
    assert hist[0]["actual_amount"] == -500
    assert hist[0]["actual_date"] is not None


def test_cycle_stop_moves_out_of_regular():
    h = _register("reg_stop")
    bid = _first_board(h)
    t = client.post("/api/tasks", headers=h, json=_cyclic_payload()).json()
    r = client.post(f"/api/tasks/{t['id']}/cycle/stop", headers=h)
    assert r.status_code == 200
    t2 = r.json()
    assert not t2["is_cyclic"] and t2["list"] != "Регулярные"


def test_complete_via_done_list_put():
    """Завершение цикла общим PUT в список со свойством done: транзит
    разрешён, регенерация создаёт следующую итерацию в «Регулярных»."""
    h = _register("reg_put")
    bid = _first_board(h)
    t = client.post("/api/tasks", headers=h, json=_cyclic_payload(amount=-700)).json()
    r = client.put(f"/api/tasks/{t['id']}", headers=h, json={"list": "Готово"})
    assert r.status_code == 200
    nxt = r.json()
    assert nxt["is_cyclic"] and nxt["list"] == "Регулярные"
    hist = client.get(f"/api/tasks/{nxt['id']}/cycle/history", headers=h).json()
    assert hist and hist[0]["actual_amount"] == -700


def test_complete_non_cyclic_400():
    h = _register("reg_nc")
    bid = _first_board(h)
    t = client.post("/api/tasks", headers=h, json={"title": "Разовое"}).json()
    assert client.post(f"/api/tasks/{t['id']}/cycle/complete", headers=h, json={}).status_code == 400


# ---------------- Бюджет: базовый слой ----------------

def test_budget_regular_layer():
    h = _register("reg_bud")
    bid = _first_board(h)
    client.post("/api/tasks", headers=h, json=_cyclic_payload(amount=-500))
    client.post("/api/tasks", headers=h, json={"title": "Билет", "amount": -120, "deadline": "2026-02-01T00:00:00"})
    b = client.get(f"/api/boards/{bid}/budget", headers=h).json()
    assert b["regular"] == -500
    assert b["operational"] == -120
    assert b["total"] == -620
    by_title = {e["title"]: e for e in b["entries"]}
    assert by_title["Аренда квартиры"]["is_regular"] is True
    assert by_title["Билет"]["is_regular"] is False


# ---------------- График: ретроспектива + прогноз ----------------

def test_cashflow_fact_events_from_history():
    h = _register("reg_cf")
    bid = _first_board(h)
    t = client.post("/api/tasks", headers=h, json=_cyclic_payload(amount=-500, cycle_period="monthly")).json()
    client.post(
        f"/api/tasks/{t['id']}/cycle/complete",
        headers=h,
        json={"actual_date": "2026-01-12T15:00:00", "actual_amount": -530},
    )
    cf = client.get(f"/api/boards/{bid}/cashflow", headers=h).json()
    facts = [e for e in cf["events"] if e.get("actual")]
    assert len(facts) == 1
    f = facts[0]
    assert f["start"] == f["end"] == "2026-01-12"
    assert f["converted"] == -530
    assert f["done"] is True and f["is_regular"] is True
    assert f["planned_amount"] == -500
    # прогнозная итерация тоже на графике — плановая сумма, следующая дата
    planned = [e for e in cf["events"] if not e.get("actual") and e["title"] == "Аренда квартиры"]
    assert planned and planned[0]["start"] == "2026-02-10"
    assert planned[0]["converted"] == -500


def test_cashflow_fact_scoped_to_board():
    """Логи второй доски не попадают на график первой."""
    h = _register("reg_cf2")
    bid = _first_board(h)
    other = client.post("/api/boards", json={"name": "Вторая"}, headers=h).json()["id"]
    t = client.post("/api/tasks", headers=h, json=_cyclic_payload(board_id=other)).json()
    client.post(f"/api/tasks/{t['id']}/cycle/complete", headers=h, json={"actual_amount": -900})
    cf = client.get(f"/api/boards/{bid}/cashflow", headers=h).json()
    assert [e for e in cf["events"] if e.get("actual")] == []
    cf2 = client.get(f"/api/boards/{other}/cashflow", headers=h).json()
    assert len([e for e in cf2["events"] if e.get("actual")]) == 1


# ---------------- Существующие БД: миграция и сидирование ----------------

def test_regular_migration_for_legacy_board():
    """Новая доска, созданная до обновления (без «Регулярных»), получает
    список при первом обращении через regular_list_name (ensure_default_lists)."""
    import sqlite3

    from app.db import SessionLocal, engine

    from app.models import Board, Task, User

    db = SessionLocal()
    board = None
    tid = None
    try:
        user = db.query(User).filter(User.username == "reg_migr").first()
        if not user:
            db.close()
            _register("reg_migr")
            db = SessionLocal()
            user = db.query(User).filter(User.username == "reg_migr").first()
        board = Board(user_id=user.id, name="Старая доска", color="#0ea5e9")
        db.add(board)
        db.commit()
        db.refresh(board)
        # имитируем старую БД: у доски нет списков вообще
        raw = sqlite3.connect(engine.url.database.replace("sqlite:///", ""))
        raw.execute("DELETE FROM task_lists WHERE board_id=?", (board.id,))
        raw.commit()
        raw.close()
        # циклическая задача с битым списком
        task = Task(
            user_id=user.id,
            board_id=board.id,
            title="Старая связь",
            is_cyclic=True,
            cycle_period="monthly",
            cycle_interval=1,
            list="Не начато",
            status="todo",
            amount=-100,
        )
        db.add(task)
        db.commit()
        tid, bid = task.id, board.id
    finally:
        db.close()

    h = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": "reg_migr", "password": "secret123"}).json()["access_token"]}
    # вызов любой операции с задачей восстанавливает инвариант и списки
    r = client.put(f"/api/tasks/{tid}", headers=h, json={"title": "Старая связь"})
    assert r.status_code == 200
    assert r.json()["list"] == "Регулярные"
    names = [l["name"] for l in client.get("/api/lists", params={"board_id": bid}, headers=h).json()]
    assert "Регулярные" in names and "Не начато" in names
