"""Перенос доски: экспорт/импорт всех задач, включая циклические (вкладка
«Импорт / Экспорт» в свойствах доски). Run: cd backend && python3 -m pytest tests/test_transfer.py -q"""
import os
import tempfile

_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/test_transfer.db"
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


def _make_task(headers, board_id, **kw):
    payload = {"title": "Задача", "board_id": board_id}
    payload.update(kw)
    r = client.post("/api/tasks", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_export_contains_everything():
    h = _register("transfer_export")
    b = _first_board(h)
    _make_task(h, b, title="Обычная", list="Не начато", amount=-100, tags=["дом"], deadline="2026-03-01T10:00:00")
    _make_task(h, b, title="Циклическая", is_cyclic=True, cycle_period="monthly", amount=500)
    # блокер: обычная блокируется циклической? нельзя — циклическая в «Регулярных»,
    # блокеры разрешены внутри доски; создадим две обычные задачи
    t1 = _make_task(h, b, title="Первая")
    _make_task(h, b, title="Вторая", blocked_by=[t1["id"]])

    r = client.get(f"/api/boards/{b}/export", headers=h)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["format"] == "mcp-todo-board"
    titles = [t["title"] for t in data["tasks"]]
    assert set(titles) == {"Обычная", "Циклическая", "Первая", "Вторая"}
    # циклическая задача экспортируется со своими настройками
    cyc = next(t for t in data["tasks"] if t["title"] == "Циклическая")
    assert cyc["is_cyclic"] is True and cyc["cycle_period"] == "monthly"
    assert cyc["list"] == "Регулярные"
    # блокер — пара индексов
    idx = {t["title"]: i for i, t in enumerate(data["tasks"])}
    assert {"blocker": idx["Первая"], "blocked": idx["Вторая"]} in data["dependencies"]
    # теги, суммы, списки
    assert {"name": "дом"} in [{"name": t["name"]} for t in data["tags"]]
    assert any(t["amount"] == -100 for t in data["tasks"])
    assert any(l["name"] == "Регулярные" for l in data["lists"])


def test_export_includes_cycle_history():
    h = _register("transfer_history")
    b = _first_board(h)
    t = _make_task(h, b, title="Аренда", is_cyclic=True, cycle_period="monthly", amount=-500,
                   deadline="2026-01-10T12:00:00")
    r = client.post(f"/api/tasks/{t['id']}/cycle/complete", headers=h,
                    json={"actual_date": "2026-01-09T09:00:00", "actual_amount": -450})
    assert r.status_code == 200, r.text
    # после выполнения итерация удалена и создана следующая — экспорт должен
    # нести и живую задачу, и историю фактов
    data = client.get(f"/api/boards/{b}/export", headers=h).json()
    assert any(t["is_cyclic"] for t in data["tasks"])
    logs = [lg for lg in data["cycle_history"] if lg["action"] == "completed"]
    assert len(logs) == 1
    assert logs[0]["actual_amount"] == -450
    assert logs[0]["task_title"] == "Аренда"


def test_import_merge_into_second_board():
    h = _register("transfer_merge")
    b1 = _first_board(h)
    t = _make_task(h, b1, title="Аренда", is_cyclic=True, cycle_period="monthly", amount=-500,
                   deadline="2026-01-10T12:00:00")
    client.post(f"/api/tasks/{t['id']}/cycle/complete", headers=h,
                json={"actual_date": "2026-01-09T09:00:00", "actual_amount": -450})
    export = client.get(f"/api/boards/{b1}/export", headers=h).json()

    # вторая доска того же пользователя
    r = client.post("/api/boards", headers=h, json={"name": "Приёмник", "color": "#0ea5e9"})
    assert r.status_code == 201, r.text
    b2 = r.json()["id"]

    r = client.post(f"/api/boards/{b2}/import", headers=h, json={"data": export, "mode": "merge"})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["tasks_created"] == len(export["tasks"])
    assert res["history_imported"] == len(export["cycle_history"])

    tasks = client.get("/api/tasks", headers=h, params={"board_id": b2}).json()
    cyc = [x for x in tasks if x["is_cyclic"]]
    assert len(cyc) == 1
    assert cyc[0]["list"] == "Регулярные"  # инвариант применён при импорте
    # история фактов переехала на новую доску
    hist = client.get(f"/api/tasks/{cyc[0]['id']}/cycle/history", headers=h).json()
    completed = [x for x in hist if x["action"] == "completed"]
    assert len(completed) == 1 and completed[0]["actual_amount"] == -450


def test_import_reimport_no_duplicate_history():
    """Повторный импорт того же файла в merge-режиме не дублирует факты."""
    h = _register("transfer_reimport")
    b1 = _first_board(h)
    t = _make_task(h, b1, title="Аренда", is_cyclic=True, cycle_period="monthly", amount=-500)
    client.post(f"/api/tasks/{t['id']}/cycle/complete", headers=h,
                json={"actual_date": "2026-01-09T09:00:00", "actual_amount": -450})
    export = client.get(f"/api/boards/{b1}/export", headers=h).json()

    r = client.post("/api/boards", headers=h, json={"name": "Приёмник2", "color": "#0ea5e9"})
    b2 = r.json()["id"]
    for _ in range(2):
        r = client.post(f"/api/boards/{b2}/import", headers=h, json={"data": export, "mode": "merge"})
        assert r.status_code == 200, r.text
    # история по содержимому дедуплицирована: фактов столько же, сколько в файле
    hist_total = sum(
        1 for lg in export["cycle_history"] if lg["action"] == "completed"
    )
    logs = [
        lg for lg in client.get(f"/api/boards/{b2}/export", headers=h).json()["cycle_history"]
        if lg["action"] == "completed"
    ]
    assert len(logs) == hist_total


def test_import_replace_wipes_board_content():
    h = _register("transfer_replace")
    b = _first_board(h)
    _make_task(h, b, title="Старая задача")
    export = client.get(f"/api/boards/{b}/export", headers=h).json()

    _make_task(h, b, title="Мусорная задача", tags=["мусор"])
    r = client.post(f"/api/boards/{b}/import", headers=h, json={"data": export, "mode": "replace"})
    assert r.status_code == 200, r.text
    tasks = client.get("/api/tasks", headers=h, params={"board_id": b}).json()
    titles = {t["title"] for t in tasks}
    assert titles == {"Старая задача"}  # «Мусорная задача» удалена
    tags = client.get("/api/tags", headers=h, params={"board_id": b}).json()
    assert all(t["name"] != "мусор" for t in tags)


def test_import_isolation_and_validation():
    """Чужая доска — 404; битые ссылки блокеров и чужой формат — 400."""
    h1 = _register("transfer_owner")
    b1 = _first_board(h1)
    export = client.get(f"/api/boards/{b1}/export", headers=h1).json()

    h2 = _register("transfer_stranger")
    b2 = _first_board(h2)
    r = client.post(f"/api/boards/{b1}/import", headers=h2, json={"data": export, "mode": "merge"})
    assert r.status_code == 404
    # чужой формат
    bad = dict(export, format="someone-else")
    r = client.post(f"/api/boards/{b2}/import", headers=h2, json={"data": bad, "mode": "merge"})
    assert r.status_code == 400
    # блокер за пределами массива задач
    bad = dict(export, dependencies=[{"blocker": 999, "blocked": 0}])
    r = client.post(f"/api/boards/{b2}/import", headers=h2, json={"data": bad, "mode": "merge"})
    assert r.status_code == 400
    # экспорт чужой доски — 404
    assert client.get(f"/api/boards/{b1}/export", headers=h2).status_code == 404
