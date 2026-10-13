"""Server statistics and database size quota (admin panel)."""
import os
import time

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings as app_settings
from ..models import Board, Tag, Task, TaskList, User, Webhook
from ..site_settings import get_setting, set_setting

DB_SIZE_LIMIT_KEY = "db_size_limit_mb"

PROCESS_STARTED = time.time()


def _db_path() -> str | None:
    url = app_settings["DATABASE_URL"]
    if url.startswith("sqlite:///"):
        return url[len("sqlite:///"):]
    return None


def get_db_sizes() -> dict:
    """Sizes of the main SQLite file and its WAL journal, in bytes."""
    path = _db_path()
    if not path:
        return {"db": 0, "wal": 0, "total": 0}
    db = os.path.getsize(path) if os.path.exists(path) else 0
    wal = os.path.getsize(path + "-wal") if os.path.exists(path + "-wal") else 0
    return {"db": db, "wal": wal, "total": db + wal}


def get_db_size_limit_mb(db: Session) -> int:
    """Configured quota in MB; 0 means unlimited."""
    try:
        return max(0, int(get_setting(db, DB_SIZE_LIMIT_KEY, "0") or 0))
    except (TypeError, ValueError):
        return 0


def set_db_size_limit_mb(db: Session, limit_mb: int) -> int:
    limit_mb = max(0, int(limit_mb))
    set_setting(db, DB_SIZE_LIMIT_KEY, str(limit_mb))
    return limit_mb


def db_size_exceeded(db: Session) -> bool:
    """True when the quota is set and the DB already exceeds it."""
    limit = get_db_size_limit_mb(db)
    if limit <= 0:
        return False
    return get_db_sizes()["total"] > limit * 1024 * 1024


def quota_error_message() -> str:
    return "Достигнут лимит размера базы данных — создание новых данных временно недоступно"


def get_server_stats(db: Session) -> dict:
    sizes = get_db_sizes()
    return {
        **sizes,
        "db_size_limit_mb": get_db_size_limit_mb(db),
        "uptime_seconds": int(time.time() - PROCESS_STARTED),
        "counts": {
            "users": db.query(func.count(User.id)).scalar() or 0,
            "boards": db.query(func.count(Board.id)).scalar() or 0,
            "tasks": db.query(func.count(Task.id)).scalar() or 0,
            "lists": db.query(func.count(TaskList.id)).scalar() or 0,
            "tags": db.query(func.count(Tag.id)).scalar() or 0,
            "webhooks": db.query(func.count(Webhook.id)).scalar() or 0,
        },
    }
