"""Task service: the single implementation of task business logic.

Both the REST router (routers/tasks.py) and the MCP tools (routers/mcp.py)
are thin wrappers around these functions, so behavior can never diverge
between the two layers. All functions are user-scoped: `user` must be a
models.User; foreign objects are treated as "not found".
"""
import uuid as _uuid
from datetime import datetime

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from ..clock import utcnow
from ..board import PALETTE, list_colors, status_for_kind
from ..models import (
    TaskChangeLog,
    Board,
    Currency,
    Tag,
    Task,
    TaskCycleLog,
    TaskList,
    User,
    task_dependencies,
    task_tags,
)
from ..routers.tags import cleanup_orphan_tags
from . import notification_service

_PROTECTED_FIELDS = {"id", "user_id", "auth_token"}  # never settable via payload


def _resolve_board(db: Session, user: User, board_id) -> Board:
    """Return the board if it belongs to the user; None/missing board is an error.
    Falls back to the user's first board for legacy callers without board_id."""
    if board_id is None:
        board = db.query(Board).filter(Board.user_id == user.id).order_by(Board.id).first()
    else:
        board = (
            db.query(Board)
            .filter(Board.id == board_id, Board.user_id == user.id)
            .first()
        )
    if not board:
        raise LookupError("Board not found")
    return board


class TaskError(Exception):
    """Business-rule violation with a user-facing message."""

    def __init__(self, message: str):
        self.message = message


# --- helpers for the blocking-task (dependencies) graph ---

def get_blocker_ids(db: Session, task_id: int) -> list[int]:
    rows = db.execute(
        select(task_dependencies.c.blocker_id).where(
            task_dependencies.c.blocked_id == task_id
        )
    ).fetchall()
    return [r[0] for r in rows]


def compute_is_blocked(db: Session, blocker_ids: list[int]) -> bool:
    if not blocker_ids:
        return False
    count = db.execute(
        select(func.count(Task.id)).where(
            Task.id.in_(blocker_ids), Task.status != "done"
        )
    ).scalar()
    return (count or 0) > 0


def set_blockers(db: Session, task_id: int, blocker_ids, user_id: int, board_id=None) -> None:
    db.execute(
        sa_delete(task_dependencies).where(
            task_dependencies.c.blocked_id == task_id
        )
    )
    seen: set[int] = set()
    for bid in (blocker_ids or []):
        if bid == task_id or bid in seen:
            continue
        seen.add(bid)
        blocker = db.get(Task, bid)
        # A task may only be blocked by tasks on the same board (spec §1.1).
        if not blocker or blocker.user_id != user_id:
            continue
        if board_id is not None and blocker.board_id != board_id:
            continue
        existing = db.execute(
            select(task_dependencies).where(
                task_dependencies.c.blocked_id == bid,
                task_dependencies.c.blocker_id == task_id,
            )
        ).first()
        if existing:
            continue
        db.execute(
            insert(task_dependencies).values(blocker_id=bid, blocked_id=task_id)
        )


def tag_palette(db, user_id: int, board_id: int | None = None) -> list:
    """Colors available for tags: the full PALETTE minus colors taken by the
    board's own lists. Per AGENTS.md there are 18 presets; when they run out,
    colors repeat."""
    used_by_lists = list_colors(db, user_id, board_id=board_id)
    return [c for c in PALETTE if c not in used_by_lists]


def _pick_tag_color(db, user_id: int, board_id: int | None = None) -> str:
    """Pick a color for a new tag: first unused one, otherwise cycle deterministically
    by the count of existing tags (colors repeat when the palette is exhausted)."""
    avail = tag_palette(db, user_id, board_id)
    if not avail:
        avail = list(PALETTE)
    q = db.query(Tag).filter(Tag.user_id == user_id)
    if board_id is not None:
        q = q.filter(Tag.board_id == board_id)
    used = {t.color for t in q.all()}
    color = next((c for c in avail if c not in used), None)
    if color is None:
        count = q.count()
        color = avail[count % len(avail)]
    return color


def repair_tag_colors(db, user_id: int, board_id: int | None = None) -> int:
    """Reassign colors to tags that ended up with a color not allowed for tags
    (e.g. the gray fallback colliding with the 'Не начато' list color)."""
    avail = tag_palette(db, user_id, board_id)
    if not avail:
        avail = list(PALETTE)
    allowed = set(avail)
    q = db.query(Tag).filter(Tag.user_id == user_id)
    if board_id is not None:
        q = q.filter(Tag.board_id == board_id)
    tags = q.all()
    used = {t.color for t in tags if t.color in allowed}
    fixed = 0
    for tag in tags:
        if tag.color in allowed:
            continue
        color = next((c for c in avail if c not in used), None)
        if color is None:
            color = avail[fixed % len(avail)]
        tag.color = color
        used.add(color)
        fixed += 1
    if fixed:
        db.commit()
    return fixed


def ensure_tags(db: Session, names, user_id: int, board_id: int | None = None) -> list:
    """Ensure Tag rows exist for each name (auto color, never colliding with
    list colors; colors repeat cyclically when the palette is exhausted).
    Tags are scoped to the given user and board.
    Returns the list of Tag ORM objects."""
    if not names:
        return []

    result = []
    for name in names:
        name = (name or "").strip()
        if not name:
            continue
        q = db.query(Tag).filter(Tag.name == name, Tag.user_id == user_id)
        if board_id is not None:
            q = q.filter(Tag.board_id == board_id)
        tag = q.first()
        if not tag:
            tag = Tag(
                name=name,
                color=_pick_tag_color(db, user_id, board_id),
                user_id=user_id,
                board_id=board_id,
            )
            db.add(tag)
            db.commit()
            db.refresh(tag)
        result.append(tag)
    return result


def _attach_state(db: Session, task: Task) -> Task:
    """Set transient attributes used for serialization (single task)."""
    _attach_state_many(db, [task])
    return task


def _attach_state_many(db: Session, tasks: list[Task]) -> None:
    """Same as _attach_state but for a batch of tasks: 3 queries total
    instead of 3 per task (avoids the N+1 problem on list endpoints)."""
    if not tasks:
        return
    ids = [t.id for t in tasks]

    blocker_rows = db.execute(
        select(
            task_dependencies.c.blocked_id, task_dependencies.c.blocker_id
        ).where(task_dependencies.c.blocked_id.in_(ids))
    ).fetchall()
    blockers_by_task = {}
    for blocked_id, blocker_id in blocker_rows:
        blockers_by_task.setdefault(blocked_id, []).append(blocker_id)

    # Statuses of all referenced blockers, in one query.
    all_blockers = {b for bl in blockers_by_task.values() for b in bl}
    statuses = (
        dict(db.query(Task.id, Task.status).filter(Task.id.in_(all_blockers)).all())
        if all_blockers
        else {}
    )

    tag_rows = (
        db.query(task_tags.c.task_id, Tag)
        .join(Tag, Tag.id == task_tags.c.tag_id)
        .filter(task_tags.c.task_id.in_(ids))
        .all()
    )
    tags_by_task = {}
    for task_id, tag in tag_rows:
        tags_by_task.setdefault(task_id, []).append(tag)

    for t in tasks:
        bl = blockers_by_task.get(t.id, [])
        t.blocked_by = bl
        t.is_blocked = any(statuses.get(b) != "done" for b in bl)
        t.tags = sorted(tags_by_task.get(t.id, []), key=lambda g: g.name)


# ---------------- Cyclic tasks ----------------

from datetime import timedelta as _timedelta

CYCLE_PERIODS = {"daily", "weekly", "monthly", "yearly"}


def advance_deadline(dt: datetime, period: str, interval: int) -> datetime:
    """Shift a deadline by (interval * period)."""
    interval = max(1, interval or 1)
    if period == "daily":
        return dt + _timedelta(days=interval)
    if period == "weekly":
        return dt + _timedelta(weeks=interval)
    if period == "monthly":
        total = dt.month - 1 + interval
        year = dt.year + total // 12
        month = total % 12 + 1
        day = min(dt.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
        return dt.replace(year=year, month=month, day=day)
    if period == "yearly":
        year = dt.year + interval
        day = min(dt.day, 29 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 28) if dt.month == 2 else dt.day
        return dt.replace(year=year, day=day)
    return dt + _timedelta(days=interval)


def cycle_log(db: Session, user_id: int, group_id: str, task: Task, action: str) -> None:
    db.add(
        TaskCycleLog(
            user_id=user_id,
            cycle_group_id=group_id,
            task_title=task.title,
            action=action,
            deadline=task.deadline,
        )
    )


def regenerate_cycle(db: Session, task: Task) -> Task:
    """Complete a cyclic iteration: log it, spawn the next one, drop the current.
    Returns the newly created next iteration."""
    next_deadline = (
        advance_deadline(task.deadline, task.cycle_period, task.cycle_interval)
        if task.deadline
        else None
    )
    next_task = Task(
        user_id=task.user_id,
        board_id=task.board_id,
        title=task.title,
        description=task.description,
        priority=task.priority,
        deadline=next_deadline,
        start_date=task.start_date,
        status="todo",
        list=_resolve_list(db, "Не начато", task.user_id)[0],
        is_cyclic=True,
        cycle_period=task.cycle_period,
        cycle_interval=task.cycle_interval,
        cycle_group_id=task.cycle_group_id,
        reminder_days=task.reminder_days,
        amount=task.amount or 0.0,
        currency_id=task.currency_id,
    )
    next_task.tags = list(task.tags)
    cycle_log(db, task.user_id, task.cycle_group_id, task, "completed")
    db.add(next_task)
    db.flush()
    db.execute(
        sa_delete(task_dependencies).where(
            (task_dependencies.c.blocker_id == task.id)
            | (task_dependencies.c.blocked_id == task.id)
        )
    )
    db.delete(task)
    db.commit()
    db.refresh(next_task)
    return next_task


def is_cycle_visible(task: Task, now: datetime) -> bool:
    """Smart visibility: a dormant cyclic task is hidden until its reminder
    window opens; blocked tasks stay visible to show the dependency chain."""
    if not task.is_cyclic:
        return True
    if getattr(task, "is_blocked", False):
        return True
    if not task.deadline:
        return True
    window_start = task.deadline - _timedelta(days=max(0, task.reminder_days or 0))
    return now >= window_start




def _resolve_list(
    db: Session, name: str | None, user_id: int, board_id: int | None = None
) -> tuple[str, str]:
    """Resolve a list name to (list_name, task_status). The status comes from
    the list's editable kind; unknown names fall back to the board's
    'Не начато' list. Scoped to the board when board_id is given."""
    def _find(nm):
        q = db.query(TaskList).filter(
            TaskList.user_id == user_id, TaskList.name == nm
        )
        if board_id is not None:
            q = q.filter(TaskList.board_id == board_id)
        return q.first()

    row = _find(name) if name else None
    if not row:
        row = _find("Не начато")
    if not row:
        return ("Не начато", "todo")
    return (row.name, status_for_kind(row.kind))


def _normalize_cyclic(task: Task, data: dict) -> None:
    if data.get("is_cyclic"):
        if data.get("cycle_period") not in CYCLE_PERIODS:
            task.cycle_period = "monthly"
        if not task.cycle_group_id:
            task.cycle_group_id = _uuid.uuid4().hex
    if task.is_cyclic:
        if task.cycle_period not in CYCLE_PERIODS:
            task.cycle_period = "monthly"
        if not task.cycle_group_id:
            task.cycle_group_id = _uuid.uuid4().hex
        task.cycle_interval = max(1, task.cycle_interval or 1)
        task.reminder_days = max(0, task.reminder_days or 0)


def list_tasks(
    db: Session,
    user: User,
    status: str | None = None,
    list_name: str | None = None,
    board_id: int | None = None,
) -> list[Task]:
    query = db.query(Task).filter(Task.user_id == user.id)
    if board_id is not None:
        query = query.filter(Task.board_id == board_id)
    if status:
        query = query.filter(Task.status == status)
    if list_name:
        query = query.filter(Task.list == list_name)
    tasks = query.all()
    _attach_state_many(db, tasks)
    now = utcnow()
    for t in tasks:
        t.cycle_dormant = not is_cycle_visible(t, now)
    return tasks


def create_task(db: Session, user: User, data: dict) -> Task:
    from . import server_stats

    if server_stats.db_size_exceeded(db):
        raise TaskError(server_stats.quota_error_message())

    data = {k: v for k, v in data.items() if k not in _PROTECTED_FIELDS}
    blocked_by = data.pop("blocked_by", None)
    tag_names = data.pop("tags", None)

    board = _resolve_board(db, user, data.get("board_id"))
    data["board_id"] = board.id

    list_name, list_status = _resolve_list(db, data.get("list"), user.id, board.id)
    data["list"] = list_name
    data["status"] = list_status

    if data.get("status") == "done" and compute_is_blocked(db, blocked_by or []):
        raise TaskError("Невозможно выполнить задачу: есть незавершённые блокирующие задачи")

    task = Task(user_id=user.id, **data)
    _normalize_cyclic(task, data)
    db.add(task)
    db.commit()
    db.refresh(task)

    if tag_names is not None:
        task.tags = ensure_tags(db, tag_names, user.id, board.id)
        db.commit()
    if blocked_by is not None:
        set_blockers(db, task.id, blocked_by, user.id, board.id)
        db.commit()
        db.refresh(task)

    notification_service.dispatch_event(db, user.id, task, "task_created")
    return task


_CHANGELOG_FIELDS = ("start_date", "deadline", "priority", "description", "amount", "list")


def _fmt_change(field: str, value) -> str | None:
    """Stringify a tracked value for the change log."""
    if value is None:
        return None
    if field in ("start_date", "deadline"):
        return value.strftime("%Y-%m-%d") if isinstance(value, datetime) else str(value)
    if field == "amount":
        # Signed money: +20000 / -10000 (для истории; в UI форматируется)
        try:
            return f"{float(value):+g}"
        except (TypeError, ValueError):
            return str(value)
    return str(value)


def log_task_changes(db: Session, user: User, task: Task, data: dict) -> None:
    """Record one row per changed tracked property (dates/priority/description)."""
    rows = []
    for field in _CHANGELOG_FIELDS:
        if field not in data:
            continue
        old_v, new_v = getattr(task, field, None), data[field]
        if old_v != new_v:
            rows.append(
                TaskChangeLog(
                    user_id=user.id,
                    task_id=task.id,
                    field=field,
                    old_value=_fmt_change(field, old_v),
                    new_value=_fmt_change(field, new_v),
                    changed_at=utcnow(),
                )
            )
    if rows:
        db.add_all(rows)
        db.commit()


def task_change_history(db: Session, user: User, task_id: int) -> list[TaskChangeLog]:
    """Chronological edit history of the task (own tasks only)."""
    return (
        db.query(TaskChangeLog)
        .filter(TaskChangeLog.task_id == task_id, TaskChangeLog.user_id == user.id)
        .order_by(TaskChangeLog.changed_at.asc(), TaskChangeLog.id.asc())
        .all()
    )


def update_task(db: Session, user: User, task_id: int, data: dict) -> Task:
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == user.id)
        .first()
    )
    if not task:
        raise LookupError("Task not found")

    old_priority = task.priority
    old_status = task.status

    data = {k: v for k, v in data.items() if k not in _PROTECTED_FIELDS}
    has_blocked_by = "blocked_by" in data
    blocked_by = data.pop("blocked_by", None)
    has_tags = "tags" in data
    tag_names = data.pop("tags", None)

    if "list" in data:
        list_name, list_status = _resolve_list(db, data["list"], user.id, task.board_id)
        data["list"] = list_name
        data["status"] = list_status

    log_task_changes(db, user, task, data)

    for key, value in data.items():
        setattr(task, key, value)
    _normalize_cyclic(task, data)

    if has_tags:
        task.tags = ensure_tags(db, tag_names or [], user.id, task.board_id)
        cleanup_orphan_tags(db, user.id)

    # A task cannot be marked done (moved to "Готово") while still blocked.
    if task.status == "done":
        ids = blocked_by if has_blocked_by else [
            r[0]
            for r in db.execute(
                select(task_dependencies.c.blocker_id).where(
                    task_dependencies.c.blocked_id == task.id
                )
            ).fetchall()
        ]
        if compute_is_blocked(db, ids or []):
            raise TaskError("Невозможно выполнить задачу: есть незавершённые блокирующие задачи")

    db.commit()
    if has_blocked_by:
        set_blockers(db, task.id, blocked_by, user.id, task.board_id)
        db.commit()
    db.refresh(task)

    # Webhook events (before the cyclic regeneration below, which deletes
    # the current iteration and would detach the object).
    if task.is_cyclic and task.status == "done":
        notification_service.dispatch_event(db, user.id, task, "task_completed")
    else:
        if task.status == "done" and old_status != "done":
            notification_service.dispatch_event(db, user.id, task, "task_completed")
        else:
            notification_service.dispatch_event(db, user.id, task, "task_updated")
            if task.priority != old_priority:
                notification_service.dispatch_event(
                    db, user.id, task, "priority_changed"
                )

    # Cyclic task completed: log the iteration and spawn the next one.
    if task.is_cyclic and task.status == "done":
        return regenerate_cycle(db, task)
    return task


def delete_task(db: Session, user: User, task_id: int) -> None:
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == user.id)
        .first()
    )
    if not task:
        raise LookupError("Task not found")

    # Snapshot for the webhook event: after the commit below the object may
    # already be detached (cyclic chains are bulk-deleted). board_id must be
    # snapshotted too — dispatch filters webhooks by the task's board.
    snapshot = (task.id, task.title, task.deadline, task.board_id)

    group_id = task.cycle_group_id if task.is_cyclic else None
    chain_ids = [task_id]
    if group_id:
        chain = (
            db.query(Task)
            .filter(Task.user_id == user.id, Task.cycle_group_id == group_id)
            .all()
        )
        chain_ids = [t.id for t in chain]

    db.execute(
        sa_delete(task_dependencies).where(
            (task_dependencies.c.blocker_id.in_(chain_ids))
            | (task_dependencies.c.blocked_id.in_(chain_ids))
        )
    )
    if group_id:
        db.query(Task).filter(
            Task.user_id == user.id, Task.cycle_group_id == group_id
        ).delete(synchronize_session=False)
    else:
        db.delete(task)
    db.commit()
    cleanup_orphan_tags(db, user.id)
    notification_service.dispatch_snapshot(
        db, user.id, *snapshot, "task_deleted"
    )


def move_task(db: Session, user: User, task_id: int, target_board_id: int) -> Task:
    """Move a task to another board owned by the same user.

    The list is kept by name when the target board has one with the same
    name; otherwise the task falls back to the target board's «Не начато».
    Blockers (same-board only) and board-scoped tags are reset."""
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == user.id)
        .first()
    )
    if not task:
        raise LookupError("Task not found")
    if target_board_id == task.board_id:
        return _attach_state(db, task)

    target = _resolve_board(db, user, target_board_id)  # raises if foreign

    lst = (
        db.query(TaskList)
        .filter(
            TaskList.user_id == user.id,
            TaskList.board_id == target.id,
            TaskList.name == task.list,
        )
        .first()
    )
    if lst:
        task.list = lst.name
        task.status = status_for_kind(lst.kind)
    else:
        task.list, task.status = _resolve_list(db, None, user.id, target.id)

    task.board_id = target.id
    # Dependencies are same-board only: drop them on move.
    db.execute(
        sa_delete(task_dependencies).where(
            (task_dependencies.c.blocker_id == task.id)
            | (task_dependencies.c.blocked_id == task.id)
        )
    )
    # Tags are scoped to a board: reset them.
    task.tags = []
    db.commit()
    db.refresh(task)
    cleanup_orphan_tags(db, user.id)
    notification_service.dispatch_event(db, user.id, task, "task_updated")
    return _attach_state(db, task)


def board_budget(db: Session, user: User, board_id: int) -> dict:
    """Board budget (property-based, UPDATE ТЗ): План = суммы в списках со
    свойством todo/progress, Факт = в списках со свойством done, ИТОГО = все
    суммы доски. Amount == 0 не участвует.

    Мультивалютность: каждая запись несёт сумму в своей валюте (code + rate),
    а все итоги и converted даются в валюте расчёта доски (report_currency_id,
    по умолчанию базовая USD). Расчёты — Decimal; missing_rate=True, когда у
    какой-то валюты не указан курс (UI показывает предупреждение)."""
    from decimal import Decimal, ROUND_HALF_UP

    from .currency_service import convert_amount, default_currency, rates_map

    board = _resolve_board(db, user, board_id)
    done_names = {
        l.name
        for l in db.query(TaskList)
        .filter(TaskList.user_id == user.id, TaskList.board_id == board.id)
        .all()
        if (l.kind or "todo") == "done"
    }
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.board_id == board.id,
            func.coalesce(Task.amount, 0) != 0,
        )
        .all()
    )
    rates = rates_map(db, user.id)
    # Валюта по умолчанию = первая в пользовательском порядке; задачи без
    # валюты (NULL) считаются заданными в ней.
    default = default_currency(db, user)
    target_id = board.report_currency_id or (default.id if default else None)
    target_rate = rates.get(target_id)

    entries = []
    missing_rate = target_id is None or not target_rate
    for t in tasks:
        # NULL currency = валюта по умолчанию (первая в списке); иная валюта
        # без курса → warning. Нет валют вообще → считаем в базовой (rate 1).
        if t.currency_id:
            src_rate = rates.get(t.currency_id)
            if not src_rate:
                missing_rate = True
        else:
            src_rate = rates.get(default.id) if default else 1.0
            if default and not src_rate:
                missing_rate = True
        converted = convert_amount(t.amount or 0, src_rate or 0, target_rate)
        if converted is None:
            missing_rate = True
        entries.append(
            {
                "id": t.id,
                "title": t.title,
                "list": t.list,
                "amount": float(t.amount or 0),
                "currency_id": t.currency_id,
                "currency_code": cur_code if (cur_code := _currency_code(db, t.currency_id)) else None,
                "converted": float(converted) if converted is not None else None,
            }
        )

    def _sum_converted(rows) -> Decimal:
        return sum(
            (Decimal(str(e["converted"])) for e in rows if e["converted"] is not None),
            Decimal(0),
        )

    total = _sum_converted(entries)
    fact = _sum_converted(e for e in entries if e["list"] in done_names)
    income = _sum_converted(e for e in entries if e["amount"] > 0)
    expense = _sum_converted(e for e in entries if e["amount"] < 0)
    cur = db.query(Currency).filter(Currency.id == target_id).first() if target_id else None
    return {
        "board_id": board.id,
        "board_name": board.name,
        "report_currency_id": target_id,
        "report_currency": {"id": cur.id, "code": cur.code, "symbol": cur.symbol}
        if cur
        else None,
        "missing_rate": missing_rate,
        "plan": float((total - fact).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "fact": float(fact.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "total": float(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "income": float(income.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "expense": float(expense.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        "entries": entries,
    }


def _currency_code(db: Session, currency_id: int | None) -> str | None:
    if not currency_id:
        return None
    cur = db.query(Currency).filter(Currency.id == currency_id).first()
    return cur.code if cur else None


def count_tasks(db: Session, user: User, board_id: int | None = None) -> dict:
    """Lightweight counters for MCP get_project_summary."""
    uid = user.id
    now = utcnow()

    def _count(**kw):
        q = db.query(Task).filter(Task.user_id == uid)
        if board_id is not None:
            q = q.filter(Task.board_id == board_id)
        return q.filter_by(**kw).count()

    overdue_q = db.query(Task).filter(Task.user_id == uid, Task.deadline < now, Task.status != "done")
    if board_id is not None:
        overdue_q = overdue_q.filter(Task.board_id == board_id)
    return {
        "total": _count(),
        "todo": _count(status="todo"),
        "in_progress": _count(status="in_progress"),
        "done": _count(status="done"),
        "overdue": overdue_q.count(),
    }


def board_cashflow(db: Session, user: User, board_id: int) -> dict:
    """Финансовый график доски (вкладка «График»): раскладка сумм задач по
    дням для прогноза баланса.

    Характер события определяется датами задачи:
      • обе даты (start_date + deadline) — «поток»: сумма равномерно
        распределяется на каждый день интервала (включительно);
      • иначе («спик») — вся сумма падает на один день: deadline, а без него
        start_date; без обеих дат задача в график не попадает (некуда
        привязать к календарю).

    Все суммы конвертируются в валюту расчёта доски (Decimal, как в
    board_budget); missing_rate=True — есть валюты без курса. Каждое событие
    несёт итог в валюте расчёта (converted) и дневную долю (per_day).
    День детализации собирает фронтенд из per_day/converted."""
    from datetime import timedelta

    from decimal import Decimal, ROUND_HALF_UP

    from .currency_service import convert_amount, default_currency, rates_map

    board = _resolve_board(db, user, board_id)
    done_names = {
        l.name
        for l in db.query(TaskList)
        .filter(TaskList.user_id == user.id, TaskList.board_id == board.id)
        .all()
        if (l.kind or "todo") == "done"
    }
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.board_id == board.id,
            func.coalesce(Task.amount, 0) != 0,
        )
        .all()
    )
    rates = rates_map(db, user.id)
    default = default_currency(db, user)
    target_id = board.report_currency_id or (default.id if default else None)
    target_rate = rates.get(target_id)

    missing_rate = target_id is None or not target_rate
    events = []
    for t in tasks:
        if t.currency_id:
            src_rate = rates.get(t.currency_id)
            if not src_rate:
                missing_rate = True
        else:
            src_rate = rates.get(default.id) if default else 1.0
            if default and not src_rate:
                missing_rate = True
        converted = convert_amount(t.amount or 0, src_rate or 0, target_rate)
        if converted is None:
            missing_rate = True
            continue  # без курса день расписать нельзя — событие пропускается
        if t.start_date and t.deadline:
            start = t.start_date.date()
            end = t.deadline.date()
            if end < start:  # инвертированный интервал — разворачиваем
                start, end = end, start
            days = (end - start).days + 1
            per_day = (converted / Decimal(days)).quantize(
                Decimal("0.0001"), rounding=ROUND_HALF_UP
            )
            events.append(
                {
                    "id": t.id,
                    "title": t.title,
                    "type": "stream",
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "days": days,
                    "converted": float(converted),
                    "per_day": float(per_day),
                    "currency_code": _currency_code(db, t.currency_id),
                    "done": t.list in done_names,
                }
            )
        else:
            anchor = (t.deadline or t.start_date)
            if anchor is None:  # нет дат — задача не попадает на график
                continue
            anchor = anchor.date()
            events.append(
                {
                    "id": t.id,
                    "title": t.title,
                    "type": "spike",
                    "start": anchor.isoformat(),
                    "end": anchor.isoformat(),
                    "days": 1,
                    "converted": float(converted),
                    "per_day": float(converted),
                    "currency_code": _currency_code(db, t.currency_id),
                    "done": t.list in done_names,
                }
            )
    cur = db.query(Currency).filter(Currency.id == target_id).first() if target_id else None
    return {
        "board_id": board.id,
        "board_name": board.name,
        "report_currency_id": target_id,
        "report_currency": {"id": cur.id, "code": cur.code, "symbol": cur.symbol}
        if cur
        else None,
        "missing_rate": missing_rate,
        "events": events,
        # Границы окна просмотра: min = самая ранняя финансовая дата − 5 дней,
        # max = самая поздняя финансовая дата + 5 дней. Определяются только по
        # задачам, имеющим start_date или deadline (спики + концы потоков).
        "window": _cashflow_window(events),
    }


def _cashflow_window(events) -> dict | None:
    """Вычислить границы окна просмотра графика по имеющимся событиям.
    Мин = самая ранняя дата события минус 5 дней, макс = самая поздняя дата
    события плюс 5 дней. Возвращает {start, end} (ISO-даты) или None, если
    событий нет."""
    if not events:
        return None
    from datetime import date as _date, timedelta

    dates = [_date.fromisoformat(d) for e in events for d in (e["start"], e["end"])]
    min_d = min(dates) - timedelta(days=5)
    max_d = max(dates) + timedelta(days=5)
    return {"start": min_d.isoformat(), "end": max_d.isoformat()}

