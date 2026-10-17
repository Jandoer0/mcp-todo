"""Security regression tests: privilege escalation, SSRF, rate limiting,
payload size/length limits. Run: cd backend && python3 -m pytest tests/ -q"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from test_isolation import client  # noqa: F401  (app with isolated temp DB)
from test_isolation import _first_board, _register


def test_register_cannot_pick_admin_role():
    """role in the register payload must be ignored — otherwise anyone
    could POST role=admin and take over the server."""
    r = client.post(
        "/api/auth/register",
        json={"username": "eviladmin", "password": "secret123", "role": "admin"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "user"

    r = client.post(
        "/api/auth/login",
        json={"username": "eviladmin", "password": "secret123"},
    )
    assert r.status_code == 200
    hdr = {"Authorization": f"Bearer {r.json()['access_token']}"}
    # No admin endpoints for a self-registered account.
    assert client.get("/api/admin/users", headers=hdr).status_code == 403


def test_register_rejects_short_password_and_username():
    r = client.post(
        "/api/auth/register", json={"username": "ab", "password": "secret123"}
    )
    assert r.status_code == 422
    r = client.post(
        "/api/auth/register", json={"username": "longusername", "password": "123"}
    )
    assert r.status_code == 422


def test_webhook_url_ssrf_rejected(monkeypatch):
    """Private/metadata targets are rejected when the test escape hatch is off."""
    hdr = _register("ssrfuser")
    board_id = _first_board(hdr)
    url = f"/api/boards/{board_id}/webhook"
    private_payloads = [
        "http://127.0.0.1:8080/hook",       # loopback
        "http://localhost/hook",             # loopback by name
        "http://169.254.169.254/meta",       # cloud metadata (link-local)
        "http://10.0.0.5/hook",              # RFC1918
        "file:///etc/passwd",                # non-http scheme
        "ftp://example.com/hook",            # non-http scheme
        "http://user:pass@example.com/hook", # credentials in URL
    ]
    monkeypatch.setenv("WEBHOOK_ALLOW_PRIVATE", "0")
    for bad in private_payloads:
        r = client.put(
            url, headers=hdr,
            json={"url": bad, "chat_id": "1", "events": ["task_created"]},
        )
        assert r.status_code == 422, f"{bad} must be rejected, got {r.status_code}"
    # A plain public URL is still accepted with the guard on.
    r = client.put(
        url, headers=hdr,
        json={"url": "https://example.com/hook", "chat_id": "1",
              "events": ["task_created"]},
    )
    assert r.status_code == 200, r.text
    # Cleanup: other tests assert the admin webhook overview is empty.
    assert client.delete(url, headers=hdr).status_code == 200


def test_login_rate_limit(monkeypatch):
    from app import security

    # Isolate: start with a clean window for this username.
    key = "login:ratevictim"
    security.reset_attempts(key)
    for _ in range(10):
        r = client.post(
            "/api/auth/login",
            json={"username": "ratevictim", "password": "wrongpass"},
        )
        assert r.status_code == 400
    r = client.post(
        "/api/auth/login",
        json={"username": "ratevictim", "password": "wrongpass"},
    )
    assert r.status_code == 429
    security.reset_attempts(key)  # don't leak state into other tests


def test_oversized_body_rejected():
    """Bodies over MAX_BODY_BYTES must 413 before Pydantic parses them."""
    big = "x" * (2 * 1024 * 1024 + 1024)
    r = client.post(
        "/api/tasks",
        json={"title": "t", "description": big, "board_id": 1},
        headers=_register("bigbody"),
    )
    assert r.status_code == 413, r.text


def test_field_length_limits():
    hdr = _register("limitsuser")
    board_id = _first_board(hdr)
    # Title over MAX_TITLE (200) -> 422
    r = client.post(
        "/api/tasks",
        headers=hdr,
        json={"title": "т" * 201, "board_id": board_id},
    )
    assert r.status_code == 422, r.text
    # Priority outside 1..3 -> 422
    r = client.post(
        "/api/tasks",
        headers=hdr,
        json={"title": "ok", "priority": 99, "board_id": board_id},
    )
    assert r.status_code == 422, r.text
    # Non-hex color for a tag -> 422
    r = client.post(
        "/api/tags",
        headers=hdr,
        json={"name": "evil", "color": "red; DROP TABLE tags", "board_id": board_id},
    )
    assert r.status_code == 422, r.text


def _sec_admin():
    """Register a user, promote to admin in the DB, return headers."""
    from app.db import SessionLocal

    client.post(
        "/api/auth/register", json={"username": "secadmin", "password": "secret123"}
    )
    db = SessionLocal()
    try:
        from app.models import User

        u = db.query(User).filter(User.username == "secadmin").first()
        if u and u.role != "admin":
            u.role = "admin"
            db.commit()
    finally:
        db.close()
    r = client.post(
        "/api/auth/login", json={"username": "secadmin", "password": "secret123"}
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_admin_settings_roundtrip():
    """GET returns every tunable; a password_min_length change takes effect
    immediately without a restart."""
    hdr = _sec_admin()
    r = client.get("/api/admin/settings", headers=hdr)
    assert r.status_code == 200
    data = r.json()
    for key in (
        "session_expire_minutes", "login_rate_limit", "login_max_attempts",
        "login_window_sec", "register_rate_limit_per_hour", "password_min_length",
        "max_body_mb", "maintenance_mode", "scheduler_interval_min",
        "deadline_window_hours", "overdue_repeat_hours", "webhook_timeout_sec",
        "max_boards_per_user", "max_description_length",
    ):
        assert key in data, key
    try:
        assert client.put(
            "/api/admin/settings", headers=hdr, json={"password_min_length": 10}
        ).status_code == 200
        # 8-char password now rejected, 10-char accepted.
        r = client.post(
            "/api/auth/register",
            json={"username": "pwuser1", "password": "12345678"},
        )
        assert r.status_code == 422
        r = client.post(
            "/api/auth/register",
            json={"username": "pwuser1", "password": "1234567890"},
        )
        assert r.status_code == 200, r.text
    finally:
        client.put(
            "/api/admin/settings", headers=hdr, json={"password_min_length": 6}
        )


def test_maintenance_mode_blocks_non_admins():
    hdr = _sec_admin()
    user_hdr = _register("maintuser")
    user_board = _first_board(user_hdr)
    user_tasks = f"/api/tasks?board_id={user_board}"
    try:
        assert client.put(
            "/api/admin/settings", headers=hdr, json={"maintenance_mode": True}
        ).status_code == 200
        # Regular user: blocked...
        assert client.get(user_tasks, headers=user_hdr).status_code == 503
        # ...but login and health stay open...
        r = client.post(
            "/api/auth/login",
            json={"username": "maintuser", "password": "secret123"},
        )
        assert r.status_code == 200
        assert client.get("/api/health").status_code == 200
        # ...and admins keep full access.
        assert client.get("/api/admin/settings", headers=hdr).status_code == 200
    finally:
        client.put(
            "/api/admin/settings", headers=hdr, json={"maintenance_mode": False}
        )
    # Off again: the user is served normally.
    assert client.get(user_tasks, headers=user_hdr).status_code == 200


def test_max_boards_setting_applies():
    """The board cap is read from settings, not the constant."""
    hdr = _sec_admin()
    try:
        assert client.put(
            "/api/admin/settings", headers=hdr, json={"max_boards_per_user": 1}
        ).status_code == 200
        user_hdr = _register("boardsuser")  # gets 1 default board
        r = client.post(
            "/api/boards",
            headers=user_hdr,
            json={"name": "Extra", "color": "#0ea5e9"},
        )
        assert r.status_code == 400
        assert "Максимальное количество досок" in r.json()["detail"]
    finally:
        client.put(
            "/api/admin/settings", headers=hdr, json={"max_boards_per_user": 20}
        )
