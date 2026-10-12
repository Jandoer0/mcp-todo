# app/clock.py — единая точка получения текущего времени.

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Current UTC time as a naive datetime.

    datetime.utcnow() is deprecated since Python 3.12; this wraps the
    recommended datetime.now(timezone.utc) and strips the tzinfo so the
    value stays comparable with naive datetimes stored in SQLite.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
