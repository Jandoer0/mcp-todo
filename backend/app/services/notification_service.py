"""Notification service: outgoing webhooks on task events.

Two sources of events:
- instant events (task created/updated/deleted/completed/priority changed)
  dispatched straight from task_service after a successful operation;
- scheduled events (task_overdue / deadline_approaching) from
  check_due_tasks(), run by the APScheduler job every 30 minutes.

HTTP delivery is fully async (httpx.AsyncClient) and never blocks the
FastAPI event loop: instant events are scheduled onto the main loop via
``run_coroutine_threadsafe`` (routers run in the threadpool), the scheduler
job runs inside the loop already.
"""
import asyncio
import hashlib
import hmac
import json
import threading
from datetime import timedelta

import httpx
from sqlalchemy.orm import Session

from ..clock import utcnow
from ..db import SessionLocal
from ..models import Task, User, Webhook
from ..site_settings import get_int, get_int_ns

# Defaults for the scheduler tunables (admin panel → Server): how far ahead
# a deadline counts as "approaching" and how often an overdue task re-fires.
DEFAULT_DEADLINE_WINDOW_HOURS = 24
DEFAULT_OVERDUE_REPEAT_HOURS = 24

EVENTS = (
    "task_created",
    "task_updated",
    "task_completed",
    "task_deleted",
    "priority_changed",
    "task_overdue",
    "deadline_approaching",
)

_TEXTS = {
    "task_created": "Создана новая задача: «{title}».",
    "task_updated": "Задача обновлена: «{title}».",
    "task_completed": "Задача выполнена: «{title}».",
    "task_deleted": "Задача удалена: «{title}».",
    "priority_changed": "Изменён приоритет задачи «{title}».",
    "task_overdue": "Задача просрочена! Требуется внимание.",
    "deadline_approaching": "Скоро дедлайн задачи «{title}» (менее 24 часов).",
}

# set in main.startup: the running asyncio loop, used for threadsafe dispatch
_main_loop: asyncio.AbstractEventLoop | None = None

# (task_id, event) -> last sent time; in-memory suppression for scheduled events
_last_notified: dict[tuple[int, str], object] = {}
_LAST_NOTIFIED_CAP = 10_000


def set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


def event_text(event: str, title: str) -> str:
    """Human-readable text for the payload; unknown events degrade to the
    event name (never formatted, so braces in it cannot break .format)."""
    template = _TEXTS.get(event)
    return template.format(title=title) if template else event


def _build(webhook: Webhook, task_id, title: str, deadline, event: str,
           board_id: int | None = None) -> dict:
    return {
        "target_chat_id": webhook.chat_id,
        "thread_id": webhook.thread_id or None,
        "event": event,
        "board_id": board_id if board_id is not None else webhook.board_id,
        "task_id": task_id,
        "title": title,
        "deadline": deadline.strftime("%Y-%m-%dT%H:%M:%SZ") if deadline else None,
        "text": event_text(event, title),
    }


def dispatch_event(db: Session, user_id: int, task: Task, event: str) -> None:
    """Fire the event to every webhook of the user subscribed to this board."""
    dispatch_snapshot(
        db, user_id, task.id, task.title, task.deadline, task.board_id, event
    )


def dispatch_snapshot(
    db: Session, user_id: int, task_id: int, title: str, deadline,
    board_id: int | None, event: str,
) -> None:
    """Same as dispatch_event but from plain fields — used after a commit when
    the ORM object may already be detached/deleted (e.g. task_deleted).
    Webhooks are board-scoped: only webhooks bound to the task's board fire;
    webhooks of users whose allowance has been revoked never fire."""
    q = (
        db.query(Webhook)
        .join(User, User.id == Webhook.user_id)
        .filter(Webhook.user_id == user_id, User.webhooks_enabled.is_(True))
    )
    if board_id is not None:
        q = q.filter(Webhook.board_id == board_id)
    webhooks = q.all()
    for webhook in webhooks:
        if not webhook.event_enabled(event):
            continue
        payload = _build(webhook, task_id, title, deadline, event, board_id)
        send_async(webhook.url, webhook.token, payload)


def send_test(webhook: Webhook) -> dict:
    """Build the test-event payload for a webhook (sent synchronously by the
    admin test endpoint so the caller can see the delivery result)."""
    return {
        "target_chat_id": webhook.chat_id,
        "thread_id": webhook.thread_id or None,
        "event": "test",
        "board_id": webhook.board_id,
        "task_id": None,
        "title": None,
        "deadline": None,
        "text": "Тестовое уведомление из OmniTask: веб-хук работает.",
    }


def send_async(url: str, secret: str | None, payload: dict) -> None:
    """Deliver the payload without blocking the caller."""
    coro = _send(url, secret, payload)
    loop = _main_loop
    if loop is not None and loop.is_running():
        asyncio.run_coroutine_threadsafe(coro, loop)
        return
    # No loop yet (e.g. before startup or in a bare script): deliver from a
    # throwaway daemon thread so the caller never blocks.
    threading.Thread(target=lambda: asyncio.run(coro), daemon=True).start()


def sign_secret(secret: str, body: bytes) -> str:
    """HMAC-SHA256 signature of the raw request body (hex digest)."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _signed_headers(secret: str | None, body: bytes) -> dict:
    """Headers for an outgoing webhook: JSON content type + HMAC signature."""
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-Hub-Signature-256"] = f"sha256={sign_secret(secret, body)}"
    return headers


def build_request(webhook: Webhook, payload: dict) -> tuple[bytes, dict]:
    """Serialize the payload to the exact raw body and build headers.
    The body is signed with HMAC-SHA256 (key = webhook secret); the signature
    goes into the X-Hub-Signature-256 header (GitHub-style 'sha256=<hex>').
    No Authorization header is sent."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return body, _signed_headers(webhook.token, body)


async def _send(url: str, secret: str | None, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = _signed_headers(secret, body)
    try:
        # Re-validate right before delivery: the host may have re-pointed to
        # an internal address since the webhook was saved (DNS rebinding).
        from ..security import validate_webhook_url

        validate_webhook_url(url)
        timeout = get_int_ns("webhook_timeout_sec", 10)
        async with httpx.AsyncClient(
            timeout=timeout, follow_redirects=False
        ) as client:
            resp = await client.post(url, content=body, headers=headers)
            resp.raise_for_status()
    except Exception as exc:  # never break the request because of a webhook
        import logging

        logging.getLogger("uvicorn.error").warning(
            "[webhook] delivery to %s failed: %s", url, exc
        )


def check_due_tasks() -> None:
    """Scheduler job: scan tasks for overdue / approaching deadlines and
    dispatch the corresponding events to subscribed webhooks."""
    db = SessionLocal()
    try:
        now = utcnow()
        window = timedelta(hours=get_int(db, "deadline_window_hours", DEFAULT_DEADLINE_WINDOW_HOURS))
        repeat_hours = get_int(db, "overdue_repeat_hours", DEFAULT_OVERDUE_REPEAT_HOURS)
        # 0 = notify once, never re-fire for the same overdue task.
        overdue_repeat = timedelta(hours=repeat_hours) if repeat_hours > 0 else None
        tasks = (
            db.query(Task)
            .filter(Task.status != "done", Task.deadline.isnot(None))
            .all()
        )
        for task in tasks:
            if task.deadline < now:
                event, repeat = "task_overdue", overdue_repeat
            elif task.deadline <= now + window:
                event, repeat = "deadline_approaching", None
            else:
                continue
            key = (task.id, event)
            last = _last_notified.get(key)
            if last and (repeat is None or now - last < repeat):
                continue
            _last_notified[key] = now
            if len(_last_notified) > _LAST_NOTIFIED_CAP:
                for k in list(_last_notified)[: _LAST_NOTIFIED_CAP // 2]:
                    _last_notified.pop(k, None)
            dispatch_event(db, task.user_id, task, event)
    finally:
        db.close()
