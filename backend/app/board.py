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

DEFAULT_LISTS = [
    {"name": "Не начато", "color": "#64748b", "position": 1, "kind": "todo"},
    {"name": "В работе", "color": "#3b82f6", "position": 2, "kind": "progress"},
    {"name": "Готово", "color": "#22c55e", "position": 3, "kind": "done"},
    {"name": "Архив", "color": "#8b5cf6", "position": 4, "kind": "done"},
]

DONE_LIST = "Готово"
PROGRESS_LIST = "В работе"

# Names of the protected default lists (cannot be created by users).
PROTECTED_LIST_NAMES = {d["name"] for d in DEFAULT_LISTS}

# Budget system lists (ТЗ бюджетирования): cannot be renamed, deleted or
# changed in any way. Amounts of tasks in these lists count as executed budget.
BUDGET_DONE_LISTS = {"Готово", "Архив"}


def status_for_list(name: str) -> str:
    """Legacy name-based status (used by migrations/seeding only)."""
    if name == DONE_LIST or name == "Архив":
        return "done"
    if name == PROGRESS_LIST:
        return "in_progress"
    return "todo"


def status_for_kind(kind) -> str:
    """Task status derived from the list's editable kind.
    Any list can be marked 'done' (завершено) by the user."""
    if kind == "done":
        return "done"
    if kind == "progress":
        return "in_progress"
    return "todo"


def ensure_default_lists(db, user_id: int, board_id: int | None = None) -> None:
    """Create the protected default lists for a user (or a specific board) if
    they are missing. Called at startup, at registration and when a new board
    is created — lists are strictly per-user and per-board."""
    from .models import TaskList

    q = db.query(TaskList.name).filter(TaskList.user_id == user_id)
    if board_id is not None:
        q = q.filter(TaskList.board_id == board_id)
    existing = {r[0] for r in q.all()}
    for spec in DEFAULT_LISTS:
        if spec["name"] not in existing:
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
    db.commit()


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
