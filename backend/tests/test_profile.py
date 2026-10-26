"""Локализация и региональные настройки профиля (ТЗ «Многоязычность»).

Настройки живут в профиле пользователя (User.language / date_format /
first_day_of_week) и применяются с любого устройства. Значения хранятся
ключами, поэтому мусор отсекается валидацией Pydantic до записи в БД.
"""
import os
import tempfile

# Изолированная временная БД (env до импорта приложения, как в test_isolation)
_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/test_profile.db"
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


def test_profile_defaults():
    h = _register("prof_defaults")
    me = client.get("/api/auth/me", headers=h).json()
    assert me["language"] == "ru"
    assert me["date_format"] == "eu"
    assert me["first_day_of_week"] == "monday"


def test_profile_update_persists():
    h = _register("prof_update")
    r = client.put(
        "/api/auth/profile",
        headers=h,
        json={"language": "en", "date_format": "us", "first_day_of_week": "sunday"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["language"] == "en"
    assert r.json()["date_format"] == "us"
    assert r.json()["first_day_of_week"] == "sunday"

    # настройки переживают новый запрос и видны через /me
    me = client.get("/api/auth/me", headers=h).json()
    assert me["language"] == "en"
    assert me["date_format"] == "us"
    assert me["first_day_of_week"] == "sunday"


def test_profile_partial_update():
    h = _register("prof_partial")
    r = client.put("/api/auth/profile", headers=h, json={"date_format": "iso"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["date_format"] == "iso"
    # остальные поля не тронуты
    assert body["language"] == "ru"
    assert body["first_day_of_week"] == "monday"


def test_profile_rejects_unknown_values():
    h = _register("prof_invalid")
    for payload in (
        {"language": "de"},
        {"date_format": "dd.mm.yy"},
        {"first_day_of_week": "0"},
    ):
        r = client.put("/api/auth/profile", headers=h, json=payload)
        assert r.status_code == 422, (payload, r.text)
    # ничего не записалось
    me = client.get("/api/auth/me", headers=h).json()
    assert me["language"] == "ru"
    assert me["date_format"] == "eu"
    assert me["first_day_of_week"] == "monday"


def test_profile_requires_auth_and_is_isolated():
    assert client.put("/api/auth/profile", json={"language": "en"}).status_code in (401, 403)

    a = _register("prof_iso_a")
    b = _register("prof_iso_b")
    client.put("/api/auth/profile", headers=a, json={"language": "en"})

    # у второго пользователя настройки свои, не чужие
    assert client.get("/api/auth/me", headers=b).json()["language"] == "ru"
