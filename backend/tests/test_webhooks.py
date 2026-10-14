"""Webhook module tests: admin CRUD, event validation, exclusion rules and
instant/scheduled event dispatch. Run: cd backend && python3 -m pytest tests/ -q"""
import json
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from test_isolation import client  # noqa: F401  (app with isolated temp DB)
from test_isolation import _first_board, _register

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


def _hook(hdr, user_id, events, excluded=None):
    from test_isolation import _first_board

    r = client.post(
        "/api/admin/webhooks",
        headers=hdr,
        json={
            "user_id": user_id,
            "board_id": _first_board(hdr),
            "name": "hook",
            "url": "https://example.com/hook",
            "token": "secret",
            "chat_id": "-1001",
            "thread_id": "9",
            "events": events,
            "excluded_events": excluded or [],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _spy():
    sent = []
    orig = ns.send_async
    ns.send_async = lambda url, token, payload: sent.append(payload)
    return sent, orig


def test_webhook_crud_and_validation():
    hdr, uid = _admin()
    hook = _hook(hdr, uid, ["task_created", "task_deleted"])
    hid = hook["id"]

    # Unknown events are rejected.
    r = client.post(
        "/api/admin/webhooks",
        headers=hdr,
        json={"user_id": uid, "board_id": _first_board(hdr), "name": "x", "url": "https://example.com/u", "chat_id": "1", "events": ["nope"]},
    )
    assert r.status_code == 400

    # Invalid webhook config gives a readable (Russian) message.
    r = client.post(
        "/api/admin/webhooks",
        headers=hdr,
        json={"user_id": uid, "board_id": _first_board(hdr), "name": "x", "url": "example.com/u", "chat_id": "1", "events": ["task_created"]},
    )
    assert r.status_code == 422
    assert "URL" in json.dumps(r.json()["detail"], ensure_ascii=False)

    # Update.
    r = client.put(
        f"/api/admin/webhooks/{hid}", headers=hdr, json={"excluded_events": ["task_created"]}
    )
    assert r.status_code == 200 and r.json()["excluded_events"] == ["task_created"]

    # List and delete.
    r = client.get("/api/admin/webhooks", headers=hdr)
    assert any(h["id"] == hid for h in r.json())
    assert client.delete(f"/api/admin/webhooks/{hid}", headers=hdr).status_code == 200


def test_excluded_events_block_dispatch():
    hdr, uid = _admin()
    hook = _hook(hdr, uid, ["task_created", "task_deleted"], excluded=["task_created"])
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
        client.delete(f"/api/admin/webhooks/{hook['id']}", headers=hdr)


def test_delete_dispatch_is_board_scoped():
    """Regression: task_deleted must fire only for webhooks bound to the
    task's board, not to every webhook of the user."""
    hdr, uid = _admin()
    hook = _hook(hdr, uid, ["task_deleted"])
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
        client.delete(f"/api/admin/webhooks/{hook['id']}", headers=hdr)
        client.delete(f"/api/boards/{other_board}", headers=hdr)


def test_task_updated_and_priority_changed():
    hdr, uid = _admin()
    hook = _hook(hdr, uid, ["task_updated", "priority_changed"])
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
        client.delete(f"/api/admin/webhooks/{hook['id']}", headers=hdr)


def test_scheduler_overdue_and_dedup():
    hdr, uid = _admin()
    hook = _hook(hdr, uid, ["task_overdue", "deadline_approaching"])
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
        client.delete(f"/api/admin/webhooks/{hook['id']}", headers=hdr)
        ns._last_notified.clear()


def test_hmac_signature_and_no_bearer():
    """The outgoing request must carry an HMAC-SHA256 signature of the raw
    body in X-Hub-Signature-256 and must NOT use an Authorization header."""
    import hashlib
    import hmac as hmac_mod
    import http.server
    import json
    import threading
    import time

    hdr, uid = _admin()
    secret = "hmac-test-secret"
    hook = _hook(hdr, uid, ["task_created"])
    client.put(
        f"/api/admin/webhooks/{hook['id']}", headers=hdr, json={"token": secret}
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
            f"/api/admin/webhooks/{hook['id']}",
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
        client.delete(f"/api/admin/webhooks/{hook['id']}", headers=hdr)
