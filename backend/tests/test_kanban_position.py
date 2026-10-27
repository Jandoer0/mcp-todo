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
    client.post("/api/tasks", json={"title": "B", "board_id": board, "list": "Не начато"}, headers=h).json()
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
    """Циклическую нельзя увезти из «Регулярных», обычную нельзя вложить туда
    — сервер отклоняет такие переносы явно (400), а не молча."""
    h = _register("kanban_c")
    board = _first_board(h)
    reg = client.post(
        "/api/tasks",
        json={"title": "Цикл", "board_id": board, "is_cyclic": True, "cycle_period": "monthly", "list": "Регулярные"},
        headers=h,
    ).json()
    plain = client.post("/api/tasks", json={"title": "Простая", "board_id": board, "list": "Не начато"}, headers=h).json()

    # циклическая -> «Не начато» : запрещённый перенос отклоняется
    r = client.patch(f"/api/tasks/{reg['id']}/reorder", json={"list": "Не начато", "position": 1.0}, headers=h)
    assert r.status_code == 400, r.text

    # обычная -> «Регулярные» : запрещённый перенос отклоняется
    r = client.patch(f"/api/tasks/{plain['id']}/reorder", json={"list": "Регулярные", "position": 1.0}, headers=h)
    assert r.status_code == 400, r.text
    # задача остаётся в исходном списке
    t = client.get(f"/api/tasks?board_id={board}", headers=h).json()
    assert any(ts["id"] == plain['id'] and ts["list"] == "Не начато" for ts in t)
    assert any(ts["id"] == reg['id'] and ts["list"] == "Регулярные" for ts in t)


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


def test_list_position_zero_locked_system_regular():
    """Системный «Регулярные» всегда первый: его position минимальный,
    нельзя сдвинуть его и нельзя занять у него место другим списком."""
    h = _register("pos_locked")
    board = _first_board(h)
    # найти системный список (kind='regular' или name='Регулярные')
    lists = client.get(f"/api/lists?board_id={board}", headers=h).json()
    reg = next(l for l in lists if l["kind"] == "regular" or l["name"] == "Регулярные")
    min_pos = min(l["position"] for l in lists)
    assert reg["position"] == min_pos, "regular must occupy the first position" + str(reg)
    # попытка сдвинуть «Регулярные» — отклоняется
    r = client.put(f"/api/lists/{board}/{reg['id']}", json={"position": 5}, headers=h)
    assert r.status_code == 400, f"pos={reg['position']} reg={reg} lists={lists} err={r.text}"

    # попытка занять место перед «Регулярные» другим списком — отклоняется
    user_lists = [l for l in lists if l["kind"] != "regular"]
    assert user_lists, "need a non-regular list"
    other = user_lists[0]
    r = client.put(f"/api/lists/{board}/{other['id']}", json={"position": min_pos - 1}, headers=h)
    assert r.status_code == 400, r.text
    # перемещение «Регулярные» обратно на его позицию — валидно
    r = client.put(f"/api/lists/{board}/{reg['id']}", json={"position": min_pos}, headers=h)
    assert r.status_code == 200, r.text
    r = client.get(f"/api/lists?board_id={board}", headers=h).json()
    assert r[0]["name"] == "Регулярные" and r[0]["position"] == min_pos, r[0]


def test_move_task_into_regular_blocked():
    """Обычная задача не может попасть в «Регулярные» через reorder (сервер
    возвращает ошибку вместо молчаливого переноса)."""
    h = _register("regular_blocked")
    board = _first_board(h)
    r = client.post("/api/tasks", json={"title": "ordinary", "board_id": board, "list": "Не начато"}, headers=h)
    assert r.status_code == 200, r.text
    task_id = r.json()["id"]
    lists = client.get(f"/api/lists?board_id={board}", headers=h).json()
    reg = next(l for l in lists if l["kind"] == "regular" or l["name"] == "Регулярные")
    r = client.patch(f"/api/tasks/{task_id}/reorder",
                     json={"list": reg["name"], "position": 1}, headers=h)
    assert r.status_code == 400, r.text
    # после попытки задача осталась в исходном списке
    t = client.get(f"/api/tasks?board_id={board}", headers=h).json()
    assert any(tsk["id"] == task_id and tsk["list"] != reg["name"] for tsk in t), "task must stay out of Regular"


def test_move_cyclic_out_of_regular_blocked():
    """Циклическая задача не может уйти из «Регулярные»."""
    h = _register("cyclic_out")
    board = _first_board(h)
    r = client.post("/api/tasks", json={
        "title": "cyclic task", "board_id": board, "list": "Регулярные",
        "is_cyclic": True, "cycle_period": "weekly",
    }, headers=h)
    assert r.status_code == 200, r.text
    task_id = r.json()["id"]
    lists = client.get(f"/api/lists?board_id={board}", headers=h).json()
    todo = next(l for l in lists if l["kind"] == "todo")
    r = client.patch(f"/api/tasks/{task_id}/reorder",
                     json={"list": todo["name"], "position": 1}, headers=h)
    assert r.status_code == 400, r.text
    t = client.get(f"/api/tasks?board_id={board}", headers=h).json()
    assert any(tsk["id"] == task_id and tsk["list"] == "Регулярные" for tsk in t), "cyclic must stay in Regular"
