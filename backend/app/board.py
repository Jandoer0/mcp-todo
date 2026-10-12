"""Board configuration shared by routers: color palette and default lists.

The task's ``list`` field stores the *name* of a TaskList. The default lists
define the high-level state of a task; protected lists cannot be renamed or
deleted, but their color and display order can be changed.
"""
from .models import TaskList

# Shared color palette. List colors may be any of these; tag colors must not
# collide with any list color.
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

# Names of the protected default lists (cannot be renamed/deleted).
PROTECTED_LIST_NAMES = {d["name"] for d in DEFAULT_LISTS}


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


def ensure_default_lists(db, user_id: int) -> None:
    """Create the protected default lists for a user if they are missing.
    Called for every existing user at startup and for each new user at
    registration — lists are strictly per-user."""
    from .models import TaskList

    existing = {
        r[0]
        for r in db.query(TaskList.name).filter(TaskList.user_id == user_id).all()
    }
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
                )
            )
    db.commit()


def list_names(db, user_id: int | None = None) -> set:
    """Board list names; scoped to the user when user_id is given."""
    q = db.query(TaskList.name)
    if user_id is not None:
        q = q.filter(TaskList.user_id == user_id)
    return {r[0] for r in q.all()}


def list_colors(db, user_id: int | None = None) -> set:
    """Colors taken by board lists; scoped to the user when user_id is given.
    Used to keep tag colors distinct from the user's own list colors."""
    q = db.query(TaskList.color)
    if user_id is not None:
        q = q.filter(TaskList.user_id == user_id)
    return {r[0] for r in q.all()}
