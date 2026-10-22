"""Горизонтальный канбан (ТЗv2 §1): поле position, дробный индекс, сортировка
list_tasks, эндпоинт PATCH /tasks/{id}/reorder, инвариант «циклическая ⇔
Регулярные» при переносе. Run: cd backend && python3 -m pytest tests/test_kanban_position.py -q"""
import os
import tempfile

_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/test_kanban.db"
os.environ["STATIC_DIR"] = _TMP + "/static"

from fastapi.testclient import TestClient

from app.main import starlette_app

client = TestClient(starlette_app)

_r = client.post("/api/auth/register", json={"username": "kanban_setup", "password": "secret123"})
assert _r.status_code == 200, _r.text
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


def test_position_order_and_append():
    h = _register("kanban_a")
    board = _first_board(h)
    ids = []
    for t in ("first", "second", "third"):
        r = client.post("/api/tasks", json={"title": t, "board_id": board, "list": "Не начато"}, headers=h)
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
    r = client.get(f"/api/tasks?board_id={board}", headers=h)
    tasks = r.json()
    pos = [t["position"] for t in tasks if t["title"] in ("first", "second", "third")]
    assert pos == sorted(pos), "new tasks must append in order"
    assert all(p > 0 for p in pos)
    # зазор дробного индекса
    assert pos[1] > pos[0] and pos[2] > pos[1]


def test_reorder_between_and_within():
    h = _register("kanban_b")
    board = _first_board(h)
    a = client.post("/api/tasks", json={"title": "A", "board_id": board, "list": "Не начато"}, headers=h).json()
    b = client.post("/api/tasks", json={"title": "B", "board_id": board, "list": "Не начато"}, headers=h).json()
    c = client.post("/api/tasks", json={"title": "C", "board_id": board, "list": "Не начато"}, headers=h).json()

    # перенос C в начало колонки: position = midpoint(0, pos(A))
    ra = client.get(f"/api/tasks?board_id={board}", headers=h).json()
    pa = next(t["position"] for t in ra if t["id"] == a["id"])
    r = client.patch(f"/api/tasks/{c['id']}/reorder", json={"list": "Не начато", "position": pa / 2}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["position"] == pa / 2

    rl = client.get(f"/api/tasks?board_id={board}", headers=h).json()
    order = [t["title"] for t in rl if t["list"] == "Не начато"]
    assert order == ["C", "A", "B"], order

    # перенос A в другую колонку
    r = client.patch(f"/api/tasks/{a['id']}/reorder", json={"list": "В работе", "position": 4096.0}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["list"] == "В работе"

    # несуществующий список -> 404
    r = client.patch(f"/api/tasks/{a['id']}/reorder", json={"list": "Нет такого", "position": 1.0}, headers=h)
    assert r.status_code == 404


def test_reorder_regular_invariant():
    """Циклическую нельзя увезти из «Регулярных», обычную нельзя вложить туда."""
    h = _register("kanban_c")
    board = _first_board(h)
    reg = client.post(
        "/api/tasks",
        json={"title": "Цикл", "board_id": board, "is_cyclic": True, "cycle_period": "monthly", "list": "Регулярные"},
        headers=h,
    ).json()
    plain = client.post("/api/tasks", json={"title": "Простая", "board_id": board, "list": "Не начато"}, headers=h).json()

    # циклическая -> «Не начато» : инвариант возвращает её в «Регулярные»
    r = client.patch(f"/api/tasks/{reg['id']}/reorder", json={"list": "Не начато", "position": 1.0}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["list"] == "Регулярные" and body["is_cyclic"] is True

    # обычная -> «Регулярные» : инвариант выталкивает в fallback
    r = client.patch(f"/api/tasks/{plain['id']}/reorder", json={"list": "Регулярные", "position": 1.0}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["list"] != "Регулярные" and body["is_cyclic"] is False


def test_reorder_into_done_with_blockers():
    h = _register("kanban_d")
    board = _first_board(h)
    blocker = client.post("/api/tasks", json={"title": "Блокер", "board_id": board, "list": "Не начато"}, headers=h).json()
    blocked = client.post(
        "/api/tasks", json={"title": "Заблокирована", "board_id": board, "list": "Не начато", "blocked_by": [blocker["id"]]},
        headers=h,
    ).json()
    r = client.patch(f"/api/tasks/{blocked['id']}/reorder", json={"list": "Готово", "position": 1.0}, headers=h)
    assert r.status_code == 400
    assert "блокирующие" in r.json()["detail"]

    # завершаем блокер переносом в done-колонку, затем перенос разрешён
    r = client.patch(f"/api/tasks/{blocker['id']}/reorder", json={"list": "Готово", "position": 1.0}, headers=h)
    assert r.status_code == 200, r.text
    r = client.patch(f"/api/tasks/{blocked['id']}/reorder", json={"list": "Готово", "position": 1.0}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["list"] == "Готово"


def test_mcp_create_appends_position():
    """MCP-создание тоже получает position (конец колонки), REST не ломается."""
    h = _register("kanban_e")
    board = _first_board(h)
    r1 = client.post("/api/tasks", json={"title": "m1", "board_id": board, "list": "Не начато"}, headers=h).json()
    r2 = client.post("/api/tasks", json={"title": "m2", "board_id": board, "list": "Не начато"}, headers=h).json()
    assert r2["position"] > r1["position"] > 0
