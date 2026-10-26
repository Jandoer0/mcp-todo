"""Board configuration shared by routers: color palette and default lists.

The task's ``list`` field stores the *name* of a TaskList. The default lists
define the high-level state of a task; protected lists cannot be renamed or
deleted, but their color and display order can be changed.
"""
from .models import TaskList, Board

# Palette for boards themselves: 20 muted colors that harmonize with the dark
# navy header (#35506b) — desaturated/fiery accents, distinct from the bright
# task palette above.
BOARD_PALETTE = [
    "#38bdf8",  # sky
    "#0ea5e9",  # ocean
    "#2dd4bf",  # teal
    "#34d399",  # emerald
    "#a3e635",  # lime
    "#facc15",  # sun
    "#fb923c",  # tangerine
    "#f87171",  # coral
    "#fb7185",  # rose
    "#f472b6",  # pink
    "#c084fc",  # lilac
    "#a78bfa",  # violet
    "#818cf8",  # indigo
    "#60a5fa",  # azure
    "#94a3b8",  # steel
    "#fbbf24",  # amber
    "#4ade80",  # green
    "#e879f9",  # orchid
    "#22d3ee",  # cyan
    "#fda4af",  # salmon
]

# Hard limit of boards per user (spec 1.1).
MAX_BOARDS_PER_USER = 20

DEFAULT_BOARD_NAME = "Личная"
DEFAULT_BOARD_COLOR = "#0ea5e9"


def ensure_default_board(db, user_id: int) -> Board:
    """Guarantee the user has at least one board (the default one). Called at
    registration and at startup for pre-existing users; also used by the
    migration to backfill legacy per-user data."""
    board = db.query(Board).filter(Board.user_id == user_id).first()
    if board:
        return board
    board = Board(
        user_id=user_id,
        name=DEFAULT_BOARD_NAME,
        color=DEFAULT_BOARD_COLOR,
        position=0,
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    return board



PALETTE = [
    "#ef4444",  # red
    "#f97316",  # orange
    "#f59e0b",  # amber
    "#eab308",  # yellow
    "#84cc16",  # lime
    "#22c55e",  # green
    "#10b981",  # emerald
    "#14b8a6",  # teal
    "#06b6d4",  # cyan
    "#0ea5e9",  # sky
    "#3b82f6",  # blue
    "#6366f1",  # indigo
    "#8b5cf6",  # violet
    "#a855f7",  # purple
    "#d946ef",  # fuchsia
    "#ec4899",  # pink
    "#f43f5e",  # rose
    "#64748b",  # slate
]

# Системный список для всех циклических (регулярных) платежей. Связь
# «циклическая ⇔ Регулярные» жёсткая: только циклические задачи могут в нём
# находиться и любая циклическая обязана в нём находиться.
#
# Локализация (ТЗ «Многоязычность»): имена дефолтных списков зависят от
# языка пользователя и фиксируются при создании списка — списки с kind и
# позициями одинаковы для всех языков, отличается только name.
# REGULAR_LIST_NAME остаётся русской константой: это ключ совместимости для
# старых строк БД и миграций, в рантайме регулярный список ищется по kind
# (см. regular_list_name в task_service).
REGULAR_LIST_NAME = "Регулярные"
REGULAR_LIST_COLOR = "#14b8a6"

# Имена дефолтных списков по языку профиля (kind → name).
DEFAULT_LIST_NAMES = {
    "ru": {
        "regular": "Регулярные",
        "todo": "Не начато",
        "progress": "В работе",
        "done": "Готово",
        "archive": "Архив",
    },
    "en": {
        "regular": "Regular",
        "todo": "To Do",
        "progress": "In Progress",
        "done": "Done",
        "archive": "Archive",
    },
}


def default_lists_for(language: str | None) -> list[dict]:
    """Protected default lists for the user's language. Names localize,
    kind/color/position — общие. Неизвестный язык -> русские имена."""
    names = DEFAULT_LIST_NAMES.get(language or "ru", DEFAULT_LIST_NAMES["ru"])
    return [
        # Регулярные — первый столбец (закрепление слева, как в ТЗ); позиции 1..5.
        {"name": names["regular"], "color": REGULAR_LIST_COLOR, "position": 1, "kind": "regular"},
        {"name": names["todo"], "color": "#64748b", "position": 2, "kind": "todo"},
        {"name": names["progress"], "color": "#3b82f6", "position": 3, "kind": "progress"},
        {"name": names["done"], "color": "#22c55e", "position": 4, "kind": "done"},
        {"name": names["archive"], "color": "#8b5cf6", "position": 5, "kind": "done"},
    ]

DONE_LIST = "Готово"
PROGRESS_LIST = "В работе"

# Свойства списков (kind): 'todo' | 'progress' | 'done'. Расчёт бюджета доски
# опирается на них (UPDATE ТЗ): План = todo/progress, Факт = done.
# Системных имён больше нет: любые списки переименовываемы, удаляемы,
# «Не начато»/«Готово»/«Архив» — обычные списки с предустановленными kind.


def status_for_list(name: str) -> str:
    """Legacy name-based status (used by migrations/seeding only)."""
    if name == DONE_LIST or name == "Архив":
        return "done"
    if name == PROGRESS_LIST:
        return "in_progress"
    return "todo"


def status_for_kind(kind) -> str:
    """Task status derived from the list's editable kind.
    Any list can be marked 'done' (завершено) by the user. The system
    regular list ('regular') behaves like a todo bucket: cyclic iterations
    are planned there and completed by moving through a done list."""
    if kind == "done":
        return "done"
    if kind == "progress":
        return "in_progress"
    return "todo"


# Требуемое число системных списков каждого kind на доске: 'done' встречается
# дважды («Готово» и «Архив»), остальные — по одному.
DEFAULT_LIST_KINDS = [("regular", 1), ("todo", 2), ("progress", 3), ("done", 4), ("done", 5)]


def _detect_board_language(rows) -> str | None:
    """Language of the board's existing system lists (по их именам). None, если
    на доске нет ни одного известного системного списка (legacy-доска)."""
    names = {r.name for r in rows}
    for lang, lang_names in DEFAULT_LIST_NAMES.items():
        if names & set(lang_names.values()):
            return lang
    return None


def ensure_default_lists(db, user_id: int, board_id: int | None = None, language: str | None = None) -> None:
    """Create the protected default lists for a user (or a specific board) if
    they are missing. Called at startup, at registration and when a new board
    is created — lists are strictly per-user and per-board.

    Идемпотентность строится на kind+position, а не на имени: имена зависят от
    языка, поэтому проверка «есть ли список с таким именем» создавала дубли
    при смене языка профиля (ru-«В работе» + en-«In Progress» на одной доске).

    Язык пересоздаваемых списков — ЯЗЫК ДОСКИ (по уже существующим системным
    спискам), а не профиля: доска, созданная на ru, сохраняет ru-имена,
    даже если пользователь потом переключился на en. Язык профиля применяется
    только к доскам без единого системного списка (новые/legacy)."""
    from .models import TaskList

    q = db.query(TaskList).filter(TaskList.user_id == user_id)
    if board_id is not None:
        q = q.filter(TaskList.board_id == board_id)
    rows = q.all()

    # Занятые слоты: (kind, position). position приводим к int (legacy-строки).
    occupied = {(r.kind or "todo", int(r.position or 0)) for r in rows}
    used_names = {r.name for r in rows}

    # Списки добираются в языке доски (не профиля) — см. докстринг.
    board_lang = _detect_board_language(rows)
    specs = default_lists_for(board_lang or language)

    added = False
    for spec in specs:
        slot = (spec["kind"], spec["position"])
        if slot in occupied:
            continue
        # На случай legacy-данных: если имя уже занято — не создаём дубль имени.
        if spec["name"] in used_names:
            continue
        db.add(
            TaskList(
                name=spec["name"],
                color=spec["color"],
                position=spec["position"],
                is_default=True,
                kind=spec["kind"],
                user_id=user_id,
                board_id=board_id,
            )
        )
        occupied.add(slot)
        used_names.add(spec["name"])
        added = True
    if added:
        db.commit()


def prune_duplicate_system_lists(db) -> int:
    """Remove system-list duplicates created by the old name-based check (до
    локализации дубли появлялись при смене языка: «Регулярные» + «Regular»).
    Удаляются только пустые дубли (на которые не ссылается ни одна задача);
    первый (по id) список слота сохраняется. Итерация — по парам
    (user_id, board_id) из самих списков, чтобы legacy-строки без Board
    тоже обрабатывались. Возвращает число удалённых."""
    from sqlalchemy import func

    from .models import Task, TaskList

    pairs = db.query(TaskList.user_id, TaskList.board_id).distinct().all()
    removed = 0
    for user_id, board_id in pairs:
        rows = (
            db.query(TaskList)
            .filter(
                TaskList.user_id == user_id,
                TaskList.board_id == board_id,
                TaskList.is_default.is_(True),
            )
            .order_by(TaskList.id)
            .all()
        )
        seen: dict[tuple, TaskList] = {}
        for row in rows:
            slot = (row.kind or "todo", int(row.position or 0))
            if slot not in seen:
                seen[slot] = row
                continue
            # Дубль слота: удаляем, только если на имя не ссылается ни одна задача.
            q = db.query(func.count(Task.id)).filter(
                Task.user_id == user_id, Task.list == row.name
            )
            if board_id is not None:
                q = q.filter(Task.board_id == board_id)
            if q.scalar():
                continue
            db.delete(row)
            removed += 1
    if removed:
        db.commit()
    return removed


def list_names(db, user_id: int | None = None, board_id: int | None = None) -> set:
    """Board list names; scoped to the board (or user) when given."""
    q = db.query(TaskList.name)
    if board_id is not None:
        q = q.filter(TaskList.board_id == board_id)
    elif user_id is not None:
        q = q.filter(TaskList.user_id == user_id)
    return {r[0] for r in q.all()}


def list_colors(db, user_id: int | None = None, board_id: int | None = None) -> set:
    """Colors taken by board lists; scoped to the user when user_id is given.
    Used to keep tag colors distinct from the user's own list colors."""
    q = db.query(TaskList.color)
    if board_id is not None:
        q = q.filter(TaskList.board_id == board_id)
    elif user_id is not None:
        q = q.filter(TaskList.user_id == user_id)
    return {r[0] for r in q.all()}
