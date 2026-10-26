"""Board CRUD: a user's workspaces. Tasks, lists and tags are strictly
board-scoped (spec §1). Max 20 boards per user."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..board import (
    BOARD_PALETTE,
    MAX_BOARDS_PER_USER,
    PALETTE,
    REGULAR_LIST_NAME,
    ensure_default_lists,
)
from ..clock import utcnow
from ..db import get_db
from ..models import (
    Board,
    Currency,
    Tag,
    Task,
    TaskChangeLog,
    TaskCycleLog,
    TaskList,
    User,
    Webhook,
    task_dependencies,
    task_tags,
)
from ..schemas import EXPORT_FORMAT, MAX_DESCRIPTION
from ..services import notification_service
from ..services.notification_service import EVENTS
from ..site_settings import get_int, get_int_ns

router = APIRouter(prefix="/boards", tags=["boards"])

MAX_NAME_LEN = 20


def get_own_board(db: Session, user: User, board_id: int) -> Board:
    """Return the board if it belongs to the user, else 404 (isolation)."""
    board = db.query(Board).filter(Board.id == board_id, Board.user_id == user.id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Доска не найдена")
    return board


@router.get("", response_model=list[schemas.BoardResponse])
def get_boards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Board)
        .filter(Board.user_id == current_user.id)
        .order_by(Board.position, Board.id)
        .all()
    )


@router.post("", response_model=schemas.BoardResponse, status_code=201)
def create_board(
    data: schemas.BoardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название доски")
    from ..services import server_stats

    if server_stats.db_size_exceeded(db):
        raise HTTPException(status_code=400, detail=server_stats.quota_error_message())
    if len(name) > MAX_NAME_LEN:
        raise HTTPException(
            status_code=400, detail=f"Название доски не длиннее {MAX_NAME_LEN} символов"
        )
    if (
        db.query(Board)
        .filter(Board.user_id == current_user.id, Board.name == name)
        .first()
    ):
        raise HTTPException(status_code=400, detail="Доска с таким именем уже есть")
    owned = db.query(Board).filter(Board.user_id == current_user.id)
    boards_limit = get_int(db, "max_boards_per_user", MAX_BOARDS_PER_USER)
    if owned.count() >= boards_limit:
        raise HTTPException(
            status_code=400,
            detail=f"Максимальное количество досок — {boards_limit}",
        )
    if data.color not in BOARD_PALETTE:
        raise HTTPException(status_code=400, detail="Цвет должен быть из палитры досок")
    pos = (
        db.query(Board)
        .filter(Board.user_id == current_user.id)
        .order_by(Board.position.desc())
        .first()
    )
    board = Board(
        user_id=current_user.id,
        name=name,
        description=data.description,
        color=data.color,
        position=(pos.position + 1) if pos else 0,
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    # A new board gets its own copy of the protected default lists.
    ensure_default_lists(db, current_user.id, board.id, language=current_user.language)
    return board


@router.put("/{board_id}", response_model=schemas.BoardResponse)
def update_board(
    board_id: int,
    data: schemas.BoardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = get_own_board(db, current_user, board_id)
    if data.report_currency_id is not None:
        # Валюта расчёта должна принадлежать пользователю (изоляция).
        from ..services.currency_service import get_own_currency

        if not get_own_currency(db, current_user, data.report_currency_id):
            raise HTTPException(status_code=400, detail="Валюта не найдена")
        board.report_currency_id = data.report_currency_id
    if data.name is not None and data.name.strip():
        name = data.name.strip()
        if len(name) > MAX_NAME_LEN:
            raise HTTPException(
                status_code=400,
                detail=f"Название доски не длиннее {MAX_NAME_LEN} символов",
            )
        if name != board.name and (
            db.query(Board)
            .filter(Board.user_id == current_user.id, Board.name == name)
            .first()
        ):
            raise HTTPException(status_code=400, detail="Доска с таким именем уже есть")
        board.name = name
    if data.description is not None:
        board.description = data.description
    if data.color is not None:
        if data.color not in BOARD_PALETTE:
            raise HTTPException(status_code=400, detail="Цвет должен быть из палитры досок")
        board.color = data.color
    if data.position is not None:
        board.position = data.position
    db.commit()
    db.refresh(board)
    return board


@router.delete("/{board_id}")
def delete_board(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = get_own_board(db, current_user, board_id)
    if db.query(Board).filter(Board.user_id == current_user.id).count() <= 1:
        raise HTTPException(status_code=400, detail="Нельзя удалить последнюю доску")
    # Cascade: a board owns its tasks, tags, lists and webhooks entirely.
    # §5.3: junction-таблицы и логи (task_tags/task_dependencies/
    # task_change_logs/task_cycle_logs) чистим явно — bulk-удаление задач
    # не трогает эти строки, и сироты накапливаются в квоте БД.
    task_ids = [
        r[0]
        for r in db.query(Task.id).filter(Task.board_id == board.id).all()
    ]
    if task_ids:
        from sqlalchemy import delete as sa_delete

        db.execute(
            sa_delete(task_dependencies).where(
                (task_dependencies.c.blocker_id.in_(task_ids))
                | (task_dependencies.c.blocked_id.in_(task_ids))
            )
        )
        db.execute(sa_delete(task_tags).where(task_tags.c.task_id.in_(task_ids)))
        db.query(TaskChangeLog).filter(
            TaskChangeLog.task_id.in_(task_ids)
        ).delete(synchronize_session=False)
    # Логи циклов привязаны к доске (board_id), а не к конкретной задаче.
    db.query(TaskCycleLog).filter(
        TaskCycleLog.board_id == board.id
    ).delete(synchronize_session=False)
    db.query(Webhook).filter(Webhook.board_id == board.id).delete()
    db.query(Task).filter(Task.board_id == board.id).delete(synchronize_session=False)
    db.query(Tag).filter(Tag.board_id == board.id).delete(synchronize_session=False)
    db.query(TaskList).filter(TaskList.board_id == board.id).delete(
        synchronize_session=False
    )
    db.delete(board)
    db.commit()
    return {"ok": True}


@router.get("/{board_id}/budget")
def get_board_budget(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Мультивалютный бюджет доски: итоги в валюте расчёта (Decimal на
    бэкенде), записи — в оригинальных валютах + конвертированный эквивалент."""
    from ..services import task_service

    try:
        return task_service.board_budget(db, current_user, board_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Доска не найдена") from None


# --- Board cashflow (financial chart) ---------------------------------------


@router.get("/{board_id}/cashflow")
def get_board_cashflow(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Раскладка сумм задач по дням для вкладки «График» (спики/потоки)."""
    from ..services import task_service

    try:
        return task_service.board_cashflow(db, current_user, board_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Доска не найдена") from None


# --- Board webhook (one per board) ------------------------------------------

# The board editor's «Веб-хуки» tab edits the single webhook of this board.
# The admin can revoke the right per user; a revoked user sees no tab, has
# their webhooks wiped and no events are dispatched (notification_service
# also checks the flag).


def _own_webhook(db: Session, user: User, board_id: int) -> Webhook:
    """The board's single webhook or 404; ownership via get_own_board."""
    get_own_board(db, user, board_id)
    return (
        db.query(Webhook)
        .filter(Webhook.board_id == board_id)
        .first()
    )


def _require_webhooks_allowed(user: User) -> None:
    if not user.webhooks_enabled:
        raise HTTPException(status_code=403, detail="Веб-хуки запрещены для этого пользователя")


@router.get("/{board_id}/webhook", response_model=schemas.WebhookResponse | None)
def get_board_webhook(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_webhooks_allowed(current_user)
    return _own_webhook(db, current_user, board_id)


@router.put("/{board_id}/webhook", response_model=schemas.WebhookResponse)
def put_board_webhook(
    board_id: int,
    data: schemas.WebhookPut,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or update the board's single webhook (one per board).
    On update only the provided fields are replaced; on creation the
    required fields (url, chat_id) must be present."""
    _require_webhooks_allowed(current_user)
    board = get_own_board(db, current_user, board_id)
    unknown = [
        e
        for e in (*(data.events or []), *(data.excluded_events or []))
        if e not in EVENTS
    ]
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"Неизвестные события: {', '.join(unknown)}"
        )
    webhook = _own_webhook(db, current_user, board_id)
    if webhook is None:
        if not data.url or not data.chat_id:
            raise HTTPException(
                status_code=400,
                detail="Укажите URL и Telegram Chat ID веб-хука",
            )
        webhook = Webhook(
            user_id=current_user.id, board_id=board.id, events=[], excluded_events=[]
        )
        db.add(webhook)
        for key, value in data.model_dump().items():
            setattr(webhook, key, value)
        webhook.events = data.events or []
        webhook.excluded_events = data.excluded_events or []
    else:
        payload = data.model_dump(exclude_unset=True, exclude_none=True)
        for key, value in payload.items():
            setattr(webhook, key, value)
    webhook.name = (webhook.name or "").strip() or f"Доска «{board.name}»"
    db.commit()
    db.refresh(webhook)
    return webhook


@router.delete("/{board_id}/webhook")
def delete_board_webhook(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_webhooks_allowed(current_user)
    webhook = _own_webhook(db, current_user, board_id)
    if webhook:
        db.delete(webhook)
        db.commit()
    return {"ok": True}


@router.post("/{board_id}/webhook/test")
async def test_board_webhook(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send a test notification synchronously so the user immediately sees
    whether the receiving endpoint is reachable."""
    import httpx

    _require_webhooks_allowed(current_user)
    webhook = _own_webhook(db, current_user, board_id)
    if not webhook:
        raise HTTPException(status_code=404, detail="Веб-хук не настроен")
    body, headers = notification_service.build_request(
        webhook, notification_service.send_test(webhook)
    )
    try:
        # Re-validate right before delivery (SSRF / DNS-rebinding guard) and
        # never follow redirects: a public URL must not bounce us inside.
        from ..security import validate_webhook_url

        validate_webhook_url(webhook.url)
        from ..site_settings import get_int

        timeout = get_int(db, "webhook_timeout_sec", 10)
        async with httpx.AsyncClient(
            timeout=timeout, follow_redirects=False
        ) as client:
            resp = await client.post(webhook.url, content=body, headers=headers)
        if resp.is_redirect:
            return {
                "ok": False,
                "status_code": resp.status_code,
                "error": "Редиректы запрещены",
            }
        ok = resp.status_code < 400
        return {
            "ok": ok,
            "status_code": resp.status_code,
            "error": None if ok else f"HTTP {resp.status_code}",
        }
    except Exception as exc:
        return {"ok": False, "status_code": None, "error": str(exc)}


# --- Перенос доски: экспорт / импорт всех задач (включая циклические) --------
# Вкладка «Импорт / Экспорт» в свойствах доски. Файл самодостаточен: списки и
# теги сопоставляются по именам, валюта — по коду, блокеры — индексами в
# массиве tasks. Идентификаторы БД не переносятся (изоляция пользователей),
# история итераций (факты «План vs Факт») переносится вместе с циклами.


def _iso(dt):
    return dt.isoformat() if dt is not None else None


@router.get("/{board_id}/export")
def export_board(
    board_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Полный снимок доски: задачи (с циклическими настройками и суммами),
    списки, теги, блокеры и история выполненных итераций."""
    from sqlalchemy import select

    board = get_own_board(db, current_user, board_id)

    tasks = (
        db.query(Task)
        .filter(Task.board_id == board.id)
        .order_by(Task.id)
        .all()
    )
    index_of = {t.id: i for i, t in enumerate(tasks)}

    # Теги задач (имена) одним запросом.
    tag_rows = (
        db.query(task_tags.c.task_id, Tag.name)
        .join(Tag, Tag.id == task_tags.c.tag_id)
        .filter(task_tags.c.task_id.in_(index_of) if index_of else False)
        .all()
    )
    tags_by_task: dict[int, list[str]] = {}
    for task_id, name in tag_rows:
        tags_by_task.setdefault(task_id, []).append(name)

    # Блокеры — парами индексов в массиве tasks.
    dep_rows = (
        db.execute(
            select(
                task_dependencies.c.blocker_id, task_dependencies.c.blocked_id
            ).where(task_dependencies.c.blocked_id.in_(index_of))
        ).fetchall()
        if index_of
        else []
    )
    dependencies = [
        {"blocker": index_of[bid], "blocked": index_of[did]}
        for bid, did in dep_rows
        if bid in index_of and did in index_of
    ]

    currencies = {
        c.id: c.code
        for c in db.query(Currency).filter(Currency.user_id == current_user.id).all()
    }

    lists = (
        db.query(TaskList)
        .filter(TaskList.board_id == board.id)
        .order_by(TaskList.position, TaskList.id)
        .all()
    )

    # История итераций: логи самой доски + «сироты» удалённых цепочек,
    # чьи group_id принадлежат живым задачам этой доски.
    live_groups = {t.cycle_group_id for t in tasks if t.is_cyclic and t.cycle_group_id}
    logs = (
        db.query(TaskCycleLog)
        .filter(
            TaskCycleLog.user_id == current_user.id,
            (TaskCycleLog.board_id == board.id)
            | (TaskCycleLog.cycle_group_id.in_(live_groups) if live_groups else False),
        )
        .order_by(TaskCycleLog.logged_at, TaskCycleLog.id)
        .all()
    )

    return {
        "format": EXPORT_FORMAT,
        "version": 1,
        "exported_at": utcnow().isoformat(),
        "board": {
            "name": board.name,
            "description": board.description,
            "color": board.color,
            "report_currency_code": currencies.get(board.report_currency_id),
        },
        "lists": [
            {
                "name": l.name,
                "color": l.color,
                "position": l.position,
                "kind": l.kind,
                "is_default": l.is_default,
            }
            for l in lists
        ],
        "tags": [
            {"name": t.name, "color": t.color}
            for t in db.query(Tag)
            .filter(Tag.board_id == board.id)
            .order_by(Tag.name)
            .all()
        ],
        "tasks": [
            {
                "title": t.title,
                "description": t.description,
                "list": t.list,
                "start_date": _iso(t.start_date),
                "deadline": _iso(t.deadline),
                "priority": t.priority,
                "amount": t.amount or 0.0,
                "currency_code": currencies.get(t.currency_id),
                "tags": sorted(tags_by_task.get(t.id, [])),
                "is_cyclic": bool(t.is_cyclic),
                "cycle_period": t.cycle_period,
                "cycle_interval": t.cycle_interval or 1,
                "cycle_group_id": t.cycle_group_id,
                "reminder_days": t.reminder_days or 0,
                "created_at": _iso(t.created_at),
            }
            for t in tasks
        ],
        "dependencies": dependencies,
        "cycle_history": [
            {
                "cycle_group_id": lg.cycle_group_id,
                "task_title": lg.task_title,
                "action": lg.action,
                "deadline": _iso(lg.deadline),
                "planned_amount": lg.planned_amount,
                "actual_amount": lg.actual_amount,
                "actual_date": _iso(lg.actual_date),
                "currency_code": currencies.get(lg.currency_id),
                "logged_at": _iso(lg.logged_at),
            }
            for lg in logs
        ],
    }


@router.post("/{board_id}/import")
def import_board(
    board_id: int,
    req: schemas.BoardImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Импорт файла экспорта на доску. mode=merge — добавить к существующим
    задачам; mode=replace — предварительно очистить задачи, теги и историю
    итераций доски (списки остаются). События веб-хуков не рассылаются."""
    from sqlalchemy import delete as sa_delete

    from ..services import server_stats, task_service

    board = get_own_board(db, current_user, board_id)
    if server_stats.db_size_exceeded(db):
        raise HTTPException(status_code=400, detail=server_stats.quota_error_message())

    data = req.data
    if data.format is not None and data.format != EXPORT_FORMAT:
        raise HTTPException(status_code=400, detail="Неизвестный формат файла")

    desc_limit = get_int_ns("max_description_length", MAX_DESCRIPTION)
    for t in data.tasks:
        if t.description and len(t.description) > desc_limit:
            raise HTTPException(
                status_code=400,
                detail=f"Описание задачи «{t.title}» длиннее {desc_limit} символов",
            )
    for dep in data.dependencies:
        if dep.blocker >= len(data.tasks) or dep.blocked >= len(data.tasks):
            raise HTTPException(status_code=400, detail="Блокер ссылается на несуществующую задачу")

    user = current_user

    # --- replace: очистка текущего содержимого доски -------------------------
    if req.mode == "replace":
        old_ids = [
            r[0] for r in db.query(Task.id).filter(Task.board_id == board.id).all()
        ]
        if old_ids:
            db.execute(
                sa_delete(task_dependencies).where(
                    task_dependencies.c.blocked_id.in_(old_ids)
                    | task_dependencies.c.blocker_id.in_(old_ids)
                )
            )
            db.execute(sa_delete(task_tags).where(task_tags.c.task_id.in_(old_ids)))
        db.query(Task).filter(Task.board_id == board.id).delete(
            synchronize_session=False
        )
        db.query(Tag).filter(Tag.board_id == board.id).delete(
            synchronize_session=False
        )
        db.query(TaskCycleLog).filter(
            TaskCycleLog.user_id == user.id, TaskCycleLog.board_id == board.id
        ).delete(synchronize_session=False)
        db.flush()

    # --- списки: недостающие создаём (сопоставление по имени) ----------------
    existing_lists = {
        l.name: l
        for l in db.query(TaskList).filter(TaskList.board_id == board.id).all()
    }
    lists_created = 0
    for spec in data.lists:
        name = spec.name.strip()
        if not name or name in existing_lists or name == REGULAR_LIST_NAME:
            continue  # «Регулярные» системный — уже есть
        color = spec.color if spec.color in PALETTE else "#64748b"
        kind = spec.kind if spec.kind in ("todo", "progress", "done") else None
        pos = (
            db.query(func.max(TaskList.position))
            .filter(TaskList.user_id == user.id, TaskList.board_id == board.id)
            .scalar()
            or 0
        ) + 1
        row = TaskList(
            name=name,
            color=color,
            position=pos,
            is_default=False,
            kind=kind,
            user_id=user.id,
            board_id=board.id,
        )
        db.add(row)
        existing_lists[name] = row
        lists_created += 1
    db.flush()

    # --- теги: недостающие создаём с экспортированным цветом -----------------
    existing_tags = {
        t.name: t
        for t in db.query(Tag).filter(Tag.board_id == board.id).all()
    }
    tags_created = 0
    for spec in data.tags:
        name = spec.name.strip()
        if not name or name in existing_tags:
            continue
        row = Tag(
            name=name,
            color=spec.color or "#64748b",
            user_id=user.id,
            board_id=board.id,
        )
        db.add(row)
        existing_tags[name] = row
        tags_created += 1
    db.flush()

    # --- валюты: код -> id пользователя --------------------------------------
    currency_by_code = {
        c.code: c.id
        for c in db.query(Currency).filter(Currency.user_id == user.id).all()
    }

    # --- cycle_group_id: при коллизии с живой цепочкой — новый id ------------
    living_groups = {
        g
        for (g,) in db.query(Task.cycle_group_id)
        .filter(
            Task.user_id == user.id,
            Task.is_cyclic.is_(True),
            Task.cycle_group_id.isnot(None),
        )
        .all()
    }
    group_remap: dict[str, str] = {}
    for t in data.tasks:
        if t.is_cyclic and t.cycle_group_id and t.cycle_group_id in living_groups:
            import uuid as _uuid

            group_remap[t.cycle_group_id] = _uuid.uuid4().hex

    # --- задачи (первый проход: без блокеров) ---------------------------------
    new_ids: list[int | None] = []
    tasks_created = 0
    for spec in data.tasks:
        list_name, list_status = task_service._resolve_list(
            db, spec.list, user.id, board.id
        )
        task = Task(
            user_id=user.id,
            board_id=board.id,
            title=spec.title,
            description=spec.description,
            list=list_name,
            status=list_status,
            start_date=spec.start_date,
            deadline=spec.deadline,
            priority=spec.priority,
            amount=spec.amount,
            currency_id=currency_by_code.get(spec.currency_code or ""),
            is_cyclic=spec.is_cyclic,
            cycle_period=spec.cycle_period,
            cycle_interval=spec.cycle_interval,
            cycle_group_id=(
                group_remap.get(spec.cycle_group_id, spec.cycle_group_id)
                if spec.is_cyclic
                else None
            ),
            reminder_days=spec.reminder_days,
            created_at=spec.created_at or utcnow(),
        )
        task_service._normalize_cyclic(task, {})
        # Жёсткая связь «циклическая ⇔ Регулярные» (как в bulk-загрузке).
        task_service.enforce_regular_list(db, task)
        tag_names = [n for n in (spec.tags or []) if n.strip()]
        if tag_names:
            missing = [n for n in tag_names if n not in existing_tags]
            if missing:
                task.tags = task_service.ensure_tags(
                    db, missing, user.id, board.id
                ) + [existing_tags[n] for n in tag_names if n in existing_tags]
            else:
                task.tags = [existing_tags[n] for n in tag_names if n in existing_tags]
        db.add(task)
        db.flush()
        new_ids.append(task.id)
        tasks_created += 1

    # --- блокеры (второй проход: все задачи уже созданы) ----------------------
    for dep in data.dependencies:
        blocked_id = new_ids[dep.blocked]
        blocker_id = new_ids[dep.blocker]
        if blocked_id and blocker_id:
            task_service.set_blockers(
                db, blocked_id, [blocker_id], user.id, board.id
            )

    # --- история итераций: перенос с дедупликацией по содержимому ------------
    existing_log_keys = {
        (lg.task_title, lg.action, lg.deadline, lg.actual_date, lg.actual_amount)
        for lg in db.query(
            TaskCycleLog.task_title,
            TaskCycleLog.action,
            TaskCycleLog.deadline,
            TaskCycleLog.actual_date,
            # §5.2: в БД копейки, а ключ дедупа сравнивается с major из payload.
            (TaskCycleLog.actual_amount_minor / 100.0).label("actual_amount"),
        )
        .filter(TaskCycleLog.user_id == user.id, TaskCycleLog.board_id == board.id)
        .all()
    }
    history_imported = 0
    history_skipped = 0
    for lg in data.cycle_history:
        key = (
            lg.task_title,
            lg.action,
            lg.deadline,
            lg.actual_date,
            lg.actual_amount,
        )
        if key in existing_log_keys:
            history_skipped += 1
            continue
        existing_log_keys.add(key)
        db.add(
            TaskCycleLog(
                user_id=user.id,
                board_id=board.id,
                cycle_group_id=group_remap.get(
                    lg.cycle_group_id, lg.cycle_group_id
                ),
                task_title=lg.task_title,
                action=lg.action,
                deadline=lg.deadline,
                planned_amount=lg.planned_amount,
                actual_amount=lg.actual_amount,
                actual_date=lg.actual_date,
                currency_id=currency_by_code.get(lg.currency_code or ""),
                logged_at=lg.logged_at or utcnow(),
            )
        )
        history_imported += 1

    db.commit()
    return {
        "ok": True,
        "mode": req.mode,
        "tasks_created": tasks_created,
        "lists_created": lists_created,
        "tags_created": tags_created,
        "history_imported": history_imported,
        "history_skipped": history_skipped,
    }
