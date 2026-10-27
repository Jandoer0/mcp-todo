"""Локализованные дефолтные списки (ТЗ «Многоязычность»): имена списков
зависят от языка профиля, семантика (kind) одинакова. Регулярный список
ищется по kind='regular', fallback — первый todo-список по позиции.
"""
import os
import tempfile

# Изолированная временная БД (env до импорта приложения, как в test_isolation)
_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/test_lists_i18n.db"
os.environ["STATIC_DIR"] = _TMP + "/static"

from fastapi.testclient import TestClient

from app.main import starlette_app

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
        r = client.put("/api/auth/profile", headers=h, json={"language": language})
        assert r.status_code == 200, r.text
    return name


def _first_board(headers):
    r = client.get("/api/boards", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


def _list_names(headers, board_id):
    r = client.get("/api/lists", params={"board_id": board_id}, headers=headers)
    assert r.status_code == 200, r.text
    return [lst["name"] for lst in r.json()]


def test_ru_user_gets_russian_default_lists():
    _register("li_ru")
    h = _login("li_ru")
    bid = _first_board(h)
    names = _list_names(h, bid)
    assert "Регулярные" in names
    assert "Не начато" in names
    assert "В работе" in names
    assert "Готово" in names
    assert "Архив" in names


def test_en_user_gets_english_default_lists():
    # Язык ставится после регистрации, новая доска создаётся уже на EN.
    _register("li_en", language="en")
    h = _login("li_en")
    r = client.post("/api/boards", headers=h, json={"name": "Work", "color": "#0ea5e9"})
    assert r.status_code == 201, r.text
    names = _list_names(h, r.json()["id"])
    assert "Regular" in names
    assert "To Do" in names
    assert "In Progress" in names
    assert "Done" in names
    assert "Archive" in names
    # Русских имён на новой доске нет
    assert "Регулярные" not in names
    assert "Не начато" not in names


def test_cyclic_task_lands_in_localized_regular_list():
    # Новая доска EN-пользователя получает EN-списки; дефолтная доска,
    # созданная при регистрации (ru), сохраняет русские имена — имя списка
    # фиксируется при создании, а не перееезжает при смене языка.
    _register("li_en_cyc", language="en")
    h = _login("li_en_cyc")
    r = client.post("/api/boards", headers=h, json={"name": "Work", "color": "#0ea5e9"})
    bid = r.json()["id"]
    r = client.post(
        "/api/tasks",
        headers=h,
        json={
            "title": "Rent",
            "is_cyclic": True,
            "cycle_period": "monthly",
            "board_id": bid,
        },
    )
    assert r.status_code == 200, r.text
    # Циклическая попала в английский Regular, а не в русские «Регулярные»
    assert r.json()["list"] == "Regular"


def test_language_switch_renames_regular_list():
    # Смена языка профиля ПЕРЕИМЕНОВЫВАЕТ системный «Регулярные» во всех
    # досках пользователя (ТЗ «Многоязычность»). Остальные списки — как есть.
    _register("li_legacy", language="en")
    h = _login("li_legacy")
    bid = _first_board(h)  # дефолтная доска была создана ещё при ru
    names = {l["name"] for l in client.get("/api/lists", params={"board_id": bid}, headers=h).json()}
    assert "Regular" in names and "Регулярные" not in names
    r = client.post(
        "/api/tasks",
        headers=h,
        json={"title": "Rent", "is_cyclic": True, "cycle_period": "monthly", "board_id": bid},
    )
    assert r.status_code == 200, r.text
    assert r.json()["list"] == "Regular"


def test_language_switch_back_renames_regular_again():
    # Туда-обратно: en → ru возвращает русское имя, задачи переезжают за ним.
    _register("li_legacy2", language=None)
    h = _login("li_legacy2")
    bid = _first_board(h)
    client.put("/api/auth/profile", headers=h, json={"language": "en"})
    client.put("/api/auth/profile", headers=h, json={"language": "ru"})
    names = {l["name"] for l in client.get("/api/lists", params={"board_id": bid}, headers=h).json()}
    assert "Регулярные" in names and "Regular" not in names


def test_regular_list_rename_still_blocked_for_localized_name():
    _register("li_en_prot", language="en")
    h = _login("li_en_prot")
    bid = _first_board(h)
    # Системный Regular нельзя переименовать и нельзя удалить
    lists = client.get("/api/lists", params={"board_id": bid}, headers=h).json()
    regular = next(l for l in lists if l["kind"] == "regular")
    r = client.put(
        f"/api/lists/{bid}/{regular['id']}", headers=h, json={"name": "Renamed"}
    )
    assert r.status_code == 400, r.text
    r = client.delete(f"/api/lists/{bid}/{regular['id']}", headers=h)
    assert r.status_code == 400, r.text


def test_delete_list_moves_tasks_to_localized_todo():
    _register("li_en_del", language="en")
    h = _login("li_en_del")
    r = client.post("/api/boards", headers=h, json={"name": "Del", "color": "#0ea5e9"})
    bid = r.json()["id"]
    client.post(
        "/api/tasks", headers=h, json={"title": "T", "list": "To Do", "board_id": bid}
    )
    lists = client.get("/api/lists", params={"board_id": bid}, headers=h).json()
    todo = next(l for l in lists if l["kind"] == "todo")
    r = client.delete(f"/api/lists/{bid}/{todo['id']}", headers=h)
    assert r.status_code == 200, r.text
    task = client.get(f"/api/tasks?board_id={bid}", headers=h).json()[0]
    # Задача переехала в первый по позиции не-regular список (In Progress),
    # а не в русское «Не начато».
    assert task["list"] == "In Progress"
