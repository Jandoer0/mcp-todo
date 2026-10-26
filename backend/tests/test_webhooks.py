"""Webhook module tests: board-scoped webhook API, admin allowance toggle,
event validation, exclusion rules and instant/scheduled event dispatch.
Run: cd backend && python3 -m pytest tests/ -q"""
import json
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from test_isolation import client  # noqa: F401  (app with isolated temp DB)
from test_isolation import _first_board

from app.board import BOARD_PALETTE
from app.clock import utcnow
from app.db import SessionLocal  # noqa: F401  (test DB access for cleanup)
from app.services import notification_service as ns

_admin_cache = None


def _admin():
    """Register a user, promote them to admin directly in the DB and log in.
    Returns (headers, user_id); cached across tests."""
    global _admin_cache
    if _admin_cache is not None:
        return _admin_cache
    name = "whadmin"
    client.post("/api/auth/register", json={"username": name, "password": "secret123"})
    db = SessionLocal()
    try:
        from app.models import User

        u = db.query(User).filter(User.username == name).first()
        u.role = "admin"
        db.commit()
        uid = u.id
    finally:
        db.close()
    r = client.post("/api/auth/login", json={"username": name, "password": "secret123"})
    hdr = {"Authorization": f"Bearer {r.json()['access_token']}"}
    _admin_cache = (hdr, uid)
    return _admin_cache


def _board_id(hdr):
    """The first board of the admin user (webhook host in most tests)."""
    return _first_board(hdr)


def _hook_url(board_id):
    return f"/api/boards/{board_id}/webhook"


def _hook(hdr, events, board_id=None, excluded=None):
    """Put the board's single webhook (create-or-update)."""
    board_id = board_id if board_id is not None else _board_id(hdr)
    r = client.put(
        _hook_url(board_id),
        headers=hdr,
        json={
            "name": "hook",
            "url": "https://example.com/hook",
            "token": "secret",
            "chat_id": "-1001",
            "thread_id": "9",
            "events": events,
            "excluded_events": excluded or [],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _del_hook(hdr, board_id):
    client.delete(_hook_url(board_id), headers=hdr)


def _spy():
    sent = []
    orig = ns.send_async
    ns.send_async = lambda url, token, payload: sent.append(payload)
    return sent, orig


def test_webhook_put_get_and_validation():
    hdr, uid = _admin()
    board_id = _board_id(hdr)

    # Unknown events are rejected.
    r = client.put(
        _hook_url(board_id),
        headers=hdr,
        json={"url": "https://example.com/u", "chat_id": "1", "events": ["nope"]},
    )
    assert r.status_code == 400

    # Invalid webhook config gives a readable (Russian) message.
    r = client.put(
        _hook_url(board_id),
        headers=hdr,
        json={"url": "example.com/u", "chat_id": "1", "events": ["task_created"]},
    )
    assert r.status_code == 422
    assert "URL" in json.dumps(r.json()["detail"], ensure_ascii=False)

    # Create, then re-put updates the same webhook (one per board).
    hook = _hook(hdr, ["task_created", "task_deleted"])
    hook2 = _hook(hdr, ["task_created", "task_deleted", "task_updated"])
    assert hook2["id"] == hook["id"]

    r = client.get(_hook_url(board_id), headers=hdr)
    assert r.status_code == 200 and r.json()["id"] == hook["id"]
    _del_hook(hdr, board_id)
    assert client.get(_hook_url(board_id), headers=hdr).json() is None


def test_admin_webhooks_overview():
    """The admin tab is a read-only overview sorted by user."""
    hdr, uid = _admin()
    board_id = _board_id(hdr)
    _hook(hdr, ["task_created"])
    try:
        r = client.get("/api/admin/webhooks", headers=hdr)
        assert r.status_code == 200
        rows = r.json()
        assert any(h["id"] for h in rows)
        hook = rows[-1]
        assert hook["board_name"], "board name must be included for the table"
        uids = [h["user_id"] for h in rows]
        assert uids == sorted(uids)
    finally:
        _del_hook(hdr, board_id)


def test_excluded_events_block_dispatch():
    hdr, uid = _admin()
    board_id = _board_id(hdr)
    _hook(hdr, ["task_created", "task_deleted"], excluded=["task_created"])
    sent, orig = _spy()
    try:
        tid = client.post("/api/tasks", headers=hdr, json={"title": "hooked"}).json()["id"]
        # task_created is excluded -> nothing sent.
        assert sent == []
        client.delete(f"/api/tasks/{tid}", headers=hdr)
        assert [p["event"] for p in sent] == ["task_deleted"]
        payload = sent[0]
        assert payload["target_chat_id"] == "-1001"
        assert payload["thread_id"] == "9"
        assert payload["task_id"] == tid
        assert payload["title"] == "hooked"
        assert payload["deadline"] is None
        assert payload["text"]
    finally:
        ns.send_async = orig
        _del_hook(hdr, board_id)


def test_delete_dispatch_is_board_scoped():
    """Regression: task_deleted must fire only for webhooks bound to the
    task's board, not to every webhook of the user."""
    hdr, uid = _admin()
    _hook(hdr, ["task_deleted"])
    r = client.post(
        "/api/boards", headers=hdr, json={"name": "other-board", "color": BOARD_PALETTE[1]}
    )
    assert r.status_code == 201, r.text
    other_board = r.json()["id"]
    sent, orig = _spy()
    try:
        tid = client.post(
            "/api/tasks", headers=hdr, json={"title": "x", "board_id": other_board}
        ).json()["id"]
        client.delete(f"/api/tasks/{tid}", headers=hdr)
        # The webhook is bound to the default board; the deleted task was on
        # the other one -> nothing must be sent.
        assert sent == []
        tid2 = client.post("/api/tasks", headers=hdr, json={"title": "y"}).json()["id"]
        client.delete(f"/api/tasks/{tid2}", headers=hdr)
        assert [p["event"] for p in sent] == ["task_deleted"]
    finally:
        ns.send_async = orig
        _del_hook(hdr, _board_id(hdr))
        client.delete(f"/api/boards/{other_board}", headers=hdr)


def test_disabling_webhooks_wipes_and_blocks():
    """Admin revokes the right -> webhooks are wiped, dispatch is blocked
    and the board-scoped webhook API returns 403."""
    hdr, uid = _admin()
    board_id = _board_id(hdr)
    _hook(hdr, ["task_created"])
    sent, orig = _spy()
    try:
        # Revoke the right.
        r = client.put(
            f"/api/admin/users/{uid}",
            headers=hdr,
            json={
                "username": "whadmin",
                "password": "",
                "role": "admin",
                "webhooks_enabled": False,
            },
        )
        assert r.status_code == 200

        # Wiped: nothing left on the server overview.
        assert client.get("/api/admin/webhooks", headers=hdr).json() == []

        # Events are not dispatched even if a webhook existed.
        client.post("/api/tasks", headers=hdr, json={"title": "blocked"})
        assert sent == []

        # The board-scoped webhook API is closed.
        url = _hook_url(board_id)
        assert client.get(url, headers=hdr).status_code == 403
        assert client.put(
            url,
            headers=hdr,
            json={"url": "https://example.com/h", "chat_id": "1", "events": []},
        ).status_code == 403

        # Grant again -> the API is open, config starts from scratch.
        client.put(
            f"/api/admin/users/{uid}",
            headers=hdr,
            json={"username": "whadmin", "password": "", "role": "admin",
                  "webhooks_enabled": True},
        )
        assert client.get(url, headers=hdr).json() is None
    finally:
        ns.send_async = orig
        client.put(
            f"/api/admin/users/{uid}",
            headers=hdr,
            json={"username": "whadmin", "password": "", "role": "admin",
                  "webhooks_enabled": True},
        )
        _del_hook(hdr, board_id)


def test_task_updated_and_priority_changed():
    hdr, uid = _admin()
    _hook(hdr, ["task_updated", "priority_changed"])
    sent, orig = _spy()
    try:
        tid = client.post("/api/tasks", headers=hdr, json={"title": "t", "priority": 1}).json()["id"]
        sent.clear()
        client.put(f"/api/tasks/{tid}", headers=hdr, json={"priority": 3})
        events = [p["event"] for p in sent]
        assert "task_updated" in events and "priority_changed" in events
    finally:
        ns.send_async = orig
        client.delete(f"/api/tasks/{tid}", headers=hdr)
        _del_hook(hdr, _board_id(hdr))


def test_scheduler_overdue_and_dedup():
    hdr, uid = _admin()
    _hook(hdr, ["task_overdue", "deadline_approaching"])
    sent, orig = _spy()
    try:
        now = utcnow()
        overdue_id = client.post(
            "/api/tasks", headers=hdr, json={"title": "late", "deadline": "2020-01-01T00:00:00Z"}
        ).json()["id"]
        soon_id = client.post(
            "/api/tasks",
            headers=hdr,
            json={"title": "soon", "deadline": (now + timedelta(hours=2)).isoformat()},
        ).json()["id"]

        ns.check_due_tasks()
        assert [p["event"] for p in sent] == ["task_overdue", "deadline_approaching"]

        # Immediate re-run: both suppressed (overdue — 24h, approaching — once).
        sent.clear()
        ns.check_due_tasks()
        assert sent == []
    finally:
        ns.send_async = orig
        client.delete(f"/api/tasks/{overdue_id}", headers=hdr)
        client.delete(f"/api/tasks/{soon_id}", headers=hdr)
        _del_hook(hdr, _board_id(hdr))
        ns._last_notified.clear()


def test_hmac_signature_and_no_bearer():
    """The outgoing request must carry an HMAC-SHA256 signature of the raw
    body in X-Hub-Signature-256 and must NOT use an Authorization header."""
    import hashlib
    import hmac as hmac_mod
    import http.server
    import threading
    import time

    hdr, uid = _admin()
    secret = "hmac-test-secret"
    board_id = _board_id(hdr)
    _hook(hdr, ["task_created"])
    client.put(
        _hook_url(board_id), headers=hdr, json={"token": secret}
    )

    captured = []

    class Receiver(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            captured.append(
                {
                    "signature": self.headers.get("X-Hub-Signature-256"),
                    "auth": self.headers.get("Authorization"),
                    "content_type": self.headers.get("Content-Type"),
                    "body": self.rfile.read(int(self.headers["Content-Length"])),
                }
            )
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Receiver)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        client.put(
            _hook_url(board_id),
            headers=hdr,
            json={"url": f"http://127.0.0.1:{srv.server_port}/hook"},
        )
        client.post("/api/tasks", headers=hdr, json={"title": "signed"})
        deadline = time.monotonic() + 5
        while not captured and time.monotonic() < deadline:
            time.sleep(0.05)
        assert captured, "webhook delivery did not arrive"

        req = captured[0]
        expected = (
            "sha256="
            + hmac_mod.new(secret.encode(), req["body"], hashlib.sha256).hexdigest()
        )
        assert req["signature"] == expected
        assert req["auth"] is None  # no Bearer token anymore
        assert req["content_type"] == "application/json"
        payload = json.loads(req["body"])
        assert payload["event"] == "task_created"
        assert payload["title"] == "signed"
    finally:
        srv.shutdown()
        _del_hook(hdr, board_id)
