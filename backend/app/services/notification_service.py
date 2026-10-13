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
import threading
from datetime import timedelta

import httpx
from sqlalchemy.orm import Session

from ..clock import utcnow
from ..db import SessionLocal
from ..models import Task, Webhook

# Re-notify an overdue task at most once a day; deadline reminders once.
OVERDUE_REPEAT = timedelta(hours=24)
DEADLINE_WINDOW = timedelta(hours=24)

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


def set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


def event_text(event: str, task: Task) -> str:
    return _TEXTS.get(event, event).format(title=task.title)


def build_payload(webhook: Webhook, task: Task, event: str) -> dict:
    """Payload in the format specified by the spec."""
    return _build(webhook, task.id, task.title, task.deadline, event)


def _build(webhook: Webhook, task_id, title: str, deadline, event: str) -> dict:
    return {
        "target_chat_id": webhook.chat_id,
        "thread_id": webhook.thread_id or None,
        "event": event,
        "task_id": task_id,
        "title": title,
        "deadline": deadline.strftime("%Y-%m-%dT%H:%M:%SZ") if deadline else None,
        "text": _TEXTS.get(event, event).format(title=title),
    }


def dispatch_event(db: Session, user_id: int, task: Task, event: str) -> None:
    """Fire the event to every webhook of the user subscribed to it."""
    dispatch_snapshot(db, user_id, task.id, task.title, task.deadline, event)


def dispatch_snapshot(
    db: Session, user_id: int, task_id: int, title: str, deadline, event: str
) -> None:
    """Same as dispatch_event but from plain fields — used after a commit when
    the ORM object may already be detached/deleted (e.g. task_deleted)."""
    webhooks = db.query(Webhook).filter(Webhook.user_id == user_id).all()
    for webhook in webhooks:
        if not webhook.event_enabled(event):
            continue
        payload = _build(webhook, task_id, title, deadline, event)
        send_async(webhook.url, webhook.token, payload)


def send_webhook(webhook_id: int, task_id: int, event: str) -> None:
    """Send a webhook by its own DB session (spec-required entry point,
    usable from background jobs)."""
    db = SessionLocal()
    try:
        webhook = db.get(Webhook, webhook_id)
        task = db.get(Task, task_id)
        if webhook and task:
            send_async(webhook.url, webhook.token, build_payload(webhook, task, event))
    finally:
        db.close()


def send_test(webhook: Webhook) -> dict:
    """Build the test-event payload for a webhook (sent synchronously by the
    admin test endpoint so the caller can see the delivery result)."""
    return {
        "target_chat_id": webhook.chat_id,
        "thread_id": webhook.thread_id or None,
        "event": "test",
        "task_id": None,
        "title": None,
        "deadline": None,
        "text": "Тестовое уведомление из OmniTask: веб-хук работает.",
    }


def send_async(url: str, token: str | None, payload: dict) -> None:
    """Deliver the payload without blocking the caller."""
    coro = _send(url, token, payload)
    loop = _main_loop
    if loop is not None and loop.is_running():
        asyncio.run_coroutine_threadsafe(coro, loop)
        return
    # No loop yet (e.g. before startup or in a bare script): deliver from a
    # throwaway daemon thread so the caller never blocks.
    threading.Thread(target=lambda: asyncio.run(coro), daemon=True).start()


async def _send(url: str, token: str | None, payload: dict) -> None:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
    except Exception as exc:  # never break the request because of a webhook
        print(f"[webhook] delivery to {url} failed: {exc}")


def check_due_tasks() -> None:
    """Scheduler job: scan tasks for overdue / approaching deadlines and
    dispatch the corresponding events to subscribed webhooks."""
    db = SessionLocal()
    try:
        now = utcnow()
        tasks = (
            db.query(Task)
            .filter(Task.status != "done", Task.deadline.isnot(None))
            .all()
        )
        for task in tasks:
            if task.deadline < now:
                event, repeat = "task_overdue", OVERDUE_REPEAT
            elif task.deadline <= now + DEADLINE_WINDOW:
                event, repeat = "deadline_approaching", None
            else:
                continue
            key = (task.id, event)
            last = _last_notified.get(key)
            if last and (repeat is None or now - last < repeat):
                continue
            _last_notified[key] = now
            dispatch_event(db, task.user_id, task, event)
    finally:
        db.close()
