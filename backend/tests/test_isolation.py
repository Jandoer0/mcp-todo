"""Data-isolation test suite: two users must never see or touch each
other's data through any API endpoint (tasks, tags, lists, summary) or the
MCP tools. Run: cd backend && python3 -m pytest tests/ -q"""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

# Isolated temp DB + static dir per test session (env must be set before app import).
_TMP = tempfile.mkdtemp()
os.makedirs(_TMP + "/static", exist_ok=True)
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP + "/test.db"
os.environ["STATIC_DIR"] = _TMP + "/static"

from app.main import starlette_app  # noqa: E402

client = TestClient(starlette_app)


def _register(name):
    r = client.post("/api/auth/register", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", json={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def users():
    return {"alice": _register("alice"), "bob": _register("bob")}


# ---------------- Tasks ----------------

def test_tasks_list_isolated(users):
    a, b = users["alice"], users["bob"]
    client.post("/api/tasks", json={"title": "A-task"}, headers=a)
    client.post("/api/tasks", json={"title": "B-task"}, headers=b)
    ta = [t["title"] for t in client.get("/api/tasks", headers=a).json()]
    tb = [t["title"] for t in client.get("/api/tasks", headers=b).json()]
    assert "A-task" in ta and "B-task" not in ta
    assert "B-task" in tb and "A-task" not in tb


def test_task_foreign_access_404(users):
    a, b = users["alice"], users["bob"]
    tid = client.post("/api/tasks", json={"title": "A-task"}, headers=a).json()["id"]
    assert client.put(f"/api/tasks/{tid}", json={"title": "x"}, headers=b).status_code == 404
    assert client.delete(f"/api/tasks/{tid}", headers=b).status_code == 404
    assert client.post(f"/api/tasks/{tid}/cycle/skip", headers=b).status_code == 404
    assert client.get(f"/api/tasks/{tid}/cycle/history", headers=b).json() == []


def test_bulk_cannot_reassign_user_id(users):
    a, b = users["alice"], users["bob"]
    tid = client.post("/api/tasks", json={"title": "A-task"}, headers=a).json()["id"]
    # bob cannot even see the task...
    r = client.post("/api/tasks/bulk", json={"tasks": [{"id": tid, "title": "hax"}]}, headers=b)
    assert r.json()["updated"] == 0 and r.json()["errors"][0]["error"] == "Task 2 not found" or "not found" in r.json()["errors"][0]["error"]
    # ...and user_id is a protected field for everyone
    r = client.post("/api/tasks/bulk", json={"tasks": [{"id": tid, "user_id": 999}]}, headers=a)
    assert r.json()["updated"] == 1
    assert len(client.get("/api/tasks", headers=a).json()) >= 1  # task stayed with alice


def test_bulk_errors_do_not_leak_internals(users):
    a = users["alice"]
    r = client.post("/api/tasks/bulk", json={"tasks": [{"id": 999999, "title": "x"}]}, headers=a)
    err = r.json()["errors"][0]["error"]
    assert "SELECT" not in err.upper() and "sqlite" not in err.lower()


def test_blockers_cannot_cross_users(users):
    a, b = users["alice"], users["bob"]
    tid = client.post("/api/tasks", json={"title": "A-task"}, headers=a).json()["id"]
    t = client.post("/api/tasks", json={"title": "B-task", "blocked_by": [tid]}, headers=b).json()
    assert t["blocked_by"] == [] and not t["is_blocked"]
    # completing a blocked task is forbidden
    a_tid = client.post("/api/tasks", json={"title": "A-blocker"}, headers=a).json()["id"]
    t2 = client.post("/api/tasks", json={"title": "A-blocked", "blocked_by": [a_tid]}, headers=a).json()
    assert t2["is_blocked"]
    assert client.put(f"/api/tasks/{t2['id']}", json={"list": "Готово"}, headers=a).status_code == 400


# ---------------- Tags ----------------

def test_tags_isolated_same_name_ok(users):
    a, b = users["alice"], users["bob"]
    client.post("/api/tasks", json={"title": "A", "tags": ["work"]}, headers=a)
    client.post("/api/tasks", json={"title": "B", "tags": ["work"]}, headers=b)
    ta = client.get("/api/tags", headers=a).json()
    tb = client.get("/api/tags", headers=b).json()
    assert [t["name"] for t in ta] == ["work"] and [t["name"] for t in tb] == ["work"]
    assert ta[0]["id"] != tb[0]["id"]
    # foreign tag is invisible for update/delete
    assert client.put(f"/api/tags/{ta[0]['id']}", json={"name": "hax"}, headers=b).status_code == 404
    assert client.delete(f"/api/tags/{ta[0]['id']}", headers=b).status_code == 404


def test_tag_color_palette_is_per_user(users):
    a, b = users["alice"], users["bob"]
    # alice takes red for her list; bob's lists don't use red
    client.post("/api/lists", json={"name": "L-A", "color": "#ef4444"}, headers=a)
    client.post("/api/lists", json={"name": "L-B", "color": "#22c55e"}, headers=b)
    assert client.post("/api/tags", json={"name": "tA", "color": "#ef4444"}, headers=a).status_code == 400
    assert client.post("/api/tags", json={"name": "tB", "color": "#ef4444"}, headers=b).status_code == 201


# ---------------- Lists ----------------

def test_lists_isolated(users):
    a, b = users["alice"], users["bob"]
    la = client.get("/api/lists", headers=a).json()
    lb = client.get("/api/lists", headers=b).json()
    assert {"Не начато", "В работе", "Готово", "Архив"} <= {l["name"] for l in la}
    assert {l["id"] for l in la}.isdisjoint({l["id"] for l in lb})
    # same custom name allowed for both
    r1 = client.post("/api/lists", json={"name": "Custom", "color": "#ef4444"}, headers=a)
    r2 = client.post("/api/lists", json={"name": "Custom", "color": "#f97316"}, headers=b)
    assert r1.status_code == 201 and r2.status_code == 201
    cid_a = r1.json()["id"]
    assert client.put(f"/api/lists/{cid_a}", json={"name": "Hax"}, headers=b).status_code == 404
    assert client.delete(f"/api/lists/{cid_a}", headers=b).status_code == 404


def test_list_delete_only_moves_own_tasks(users):
    a, b = users["alice"], users["bob"]
    for u in ("alice", "bob"):
        client.post("/api/lists", json={"name": f"D-{u}", "color": "#f59e0b"}, headers=users[u])
        client.post("/api/tasks", json={"title": f"T-{u}", "list": f"D-{u}"}, headers=users[u])
    lid_b = [l for l in client.get("/api/lists", headers=b).json() if l["name"] == "D-bob"][0]["id"]
    assert client.delete(f"/api/lists/{lid_b}", headers=b).status_code == 200
    ta = [t for t in client.get("/api/tasks", headers=a).json() if t["title"] == "T-alice"][0]
    tb = [t for t in client.get("/api/tasks", headers=b).json() if t["title"] == "T-bob"][0]
    assert ta["list"] == "D-alice"      # alice untouched
    assert tb["list"] == "Не начато"    # bob reassigned


# ---------------- Summary ----------------

def test_summary_isolated(users):
    a = users["alice"]
    s = client.get("/api/summary", headers=a).json()
    tasks_a = client.get("/api/tasks", headers=a).json()
    assert s["total"] == len(tasks_a)


# ---------------- MCP tools ----------------

def _mcp_token(auth_header):
    return auth_header["Authorization"].split(" ", 1)[1]


def test_mcp_tools_isolated(users):
    import json
    from app.routers.mcp import (
        list_tasks,
        create_task,
        update_task,
        delete_task,
        search_tasks,
        get_project_summary,
    )
    tok_a = _mcp_token(users["alice"])
    tok_b = _mcp_token(users["bob"])
    # bad token rejected
    assert list_tasks(auth_token="bad").startswith("Error")
    ta = json.loads(list_tasks(auth_token=tok_a))
    tb = json.loads(list_tasks(auth_token=tok_b))
    assert {t["title"] for t in ta}.isdisjoint({t["title"] for t in tb})
    # foreign task invisible for update/delete/search
    tid_a = ta[0]["id"]
    assert update_task(auth_token=tok_b, task_id=tid_a, title="hax") == "Task not found"
    assert delete_task(auth_token=tok_b, task_id=tid_a) == "Task not found"
    assert json.loads(search_tasks(auth_token=tok_b, query_str=ta[0]["title"])) == []
    # summary counts only own tasks
    sa = json.loads(get_project_summary(auth_token=tok_a))
    assert sa["total"] == len(ta)
    # created via MCP lands with the right owner
    assert create_task(auth_token=tok_b, title="MCP-only").startswith("Task created")
    assert "MCP-only" not in {t["title"] for t in json.loads(list_tasks(auth_token=tok_a))}


def test_health_and_registration_status():
    assert client.get("/api/health").json()["status"] == "ok"
    assert "enabled" in client.get("/api/auth/registration-status").json()
