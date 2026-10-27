"""Регрессия: смена языка профиля не должна дублировать системные списки.

Баг: ensure_default_lists проверял существование списка по ИМЕНИ, а имена
локализованы — на ru-доске EN-пользователя создавались EN-дубли («Regular»
рядом с «Регулярные», «In Progress» рядом с «В работе»), включая списки,
которые пользователь сам удалил.

Фикс: идемпотентность по слоту (kind, position); пересоздание недостающего
списка — в ЯЗЫКЕ ДОСКИ (по существующим системным спискам), а не профиля.
Накопленные в БД дубли убирает prune_duplicate_system_lists при старте.
"""
import os
import tempfile

# Изолированная временная БД (env до импорта приложения, как в test_isolation)
_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/test_lists_dupe.db"
os.environ["STATIC_DIR"] = _TMP + "/static"

from fastapi.testclient import TestClient

from app.board import ensure_default_lists, prune_duplicate_system_lists
from app.db import SessionLocal
from app.main import starlette_app
from app.models import Task, TaskList, User

client = TestClient(starlette_app)


def _login(name):
    r = client.post("/api/auth/login", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _register(name, language=None):
    r = client.post("/api/auth/register", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    if language:
        h = _login(name)
        assert client.put("/api/auth/profile", headers=h, json={"language": language}).status_code == 200


def _first_board(headers):
    r = client.get("/api/boards", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


def _list_names(headers, board_id):
    r = client.get("/api/lists", params={"board_id": board_id}, headers=headers)
    assert r.status_code == 200, r.text
    return sorted(lst["name"] for lst in r.json())


def _db():
    return SessionLocal()


def test_language_switch_does_not_duplicate_system_lists():
    """Смена языка на en не добавляет EN-версии к ru-спискам доски."""
    _register("dupe_switch", language="en")
    h = _login("dupe_switch")
    bid = _first_board(h)

    db = _db()
    try:
        user = db.query(User).filter(User.username == "dupe_switch").first()
        # Симуляция старта сервера: ensure для каждой доски (как в seed_lists)
        ensure_default_lists(db, user.id, bid, language=user.language)
        ensure_default_lists(db, user.id, bid, language=user.language)  # повтор
    finally:
        db.close()

    names = _list_names(h, bid)
    # Дублей нет: 5 системных списков; «Регулярные» при смене языка
    # переименован в «Regular» (rename_regular_lists), остальные — как есть.
    assert names == sorted(["Regular", "Не начато", "В работе", "Готово", "Архив"]), names


def test_missing_list_recreated_in_board_language():
    """Удалённый «В работе» на ru-доске пересоздаётся по-русски, даже если
    профиль пользователя уже en («In Progress» не появляется)."""
    _register("dupe_missing", language="en")
    h = _login("dupe_missing")
    bid = _first_board(h)

    # Удаляем progress-список через API
    lists = client.get("/api/lists", params={"board_id": bid}, headers=h).json()
    progress = next(l for l in lists if l["kind"] == "progress")
    assert client.delete(f"/api/lists/{bid}/{progress['id']}", headers=h).status_code == 200

    db = _db()
    try:
        user = db.query(User).filter(User.username == "dupe_missing").first()
        ensure_default_lists(db, user.id, bid, language=user.language)
    finally:
        db.close()

    names = _list_names(h, bid)
    assert "В работе" in names, names       # язык ДОСКИ, не профиля
    assert "In Progress" not in names, names


def test_prune_merges_duplicates_and_moves_tasks():
    """prune схлопывает дубли слотов ВСЕГДА: пустые просто удаляются,
    с задачами — задачи переносятся на канонический список (первый по id).
    Так лечится прод-случай Tubular: «Regular» с 9 циклическими задачами
    рядом с «Регулярные»."""
    _register("dupe_prune")
    h = _login("dupe_prune")
    bid = _first_board(h)
    db = _db()
    try:
        user = db.query(User).filter(User.username == "dupe_prune").first()
        # Пустой EN-дубль регулярного списка (как создал старый ensure)
        db.add(TaskList(name="Regular", color="#14b8a6", position=1, is_default=True,
                        kind="regular", user_id=user.id, board_id=bid))
        # Дубль todo-слота, на который ссылается задача
        db.add(TaskList(name="To Do", color="#64748b", position=2, is_default=True,
                        kind="todo", user_id=user.id, board_id=bid))
        db.commit()
        db.add(Task(user_id=user.id, board_id=bid, title="Attached", list="To Do", status="todo"))
        db.commit()

        removed = prune_duplicate_system_lists(db)
        assert removed == 2, removed  # оба дубля слотов удалены

        left = sorted(
            r.name for r in db.query(TaskList)
            .filter(TaskList.user_id == user.id, TaskList.board_id == bid,
                    TaskList.is_default.is_(True)).all()
        )
        assert "Regular" not in left and "To Do" not in left, left
        # Задача перенесена на канонический todo-список доски
        task = db.query(Task).filter(Task.user_id == user.id, Task.title == "Attached").first()
        assert task.list == "Не начато", task.list
    finally:
        db.close()


def test_en_board_gets_en_lists_when_empty():
    """На полностью пустой доске EN-пользователя (нет ни одного системного
    списка) списки создаются в EN — язык профиля применим только здесь."""
    _register("dupe_empty_en", language="en")
    h = _login("dupe_empty_en")
    r = client.post("/api/boards", headers=h, json={"name": "Fresh", "color": "#0ea5e9"})
    bid = r.json()["id"]

    db = _db()
    try:
        user = db.query(User).filter(User.username == "dupe_empty_en").first()
        ensure_default_lists(db, user.id, bid, language=user.language)
    finally:
        db.close()

    names = _list_names(h, bid)
    assert names == sorted(["Regular", "To Do", "In Progress", "Done", "Archive"]), names
