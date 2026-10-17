"""Site-wide settings stored in the DB (simple key/value store).

Hot paths (request body limit, webhook timeout, schema validators) read
through an in-process cache so they never hit SQLite per request. The cache
is written on every set/ensure and warmed at startup by ensure_defaults().
"""
from .models import Setting

# Every tunable the admin panel can edit: key -> default (string form).
# Anything not listed here is env-only (secrets / boot-time config).
DEFAULTS: dict[str, str] = {
    # --- Security ---
    "session_expire_minutes": "480",   # JWT lifetime for new logins
    "login_rate_limit": "true",        # brute-force guard on /auth/login
    "login_max_attempts": "10",        # attempts per username...
    "login_window_sec": "300",         # ...inside this window
    "register_rate_limit_per_hour": "30",  # signups per IP per hour
    "password_min_length": "6",
    "max_body_mb": "2",                # request body cap (413 above it)
    "maintenance_mode": "false",       # 503 for everyone except admins
    # --- Notifications / scheduler ---
    "scheduler_interval_min": "30",    # overdue/deadline scan period
    "deadline_window_hours": "24",     # "deadline approaching" horizon
    "overdue_repeat_hours": "24",      # repeat overdue notice (0 = once)
    "webhook_timeout_sec": "10",
    # --- Limits ---
    "max_boards_per_user": "20",
    "max_description_length": "50000",
}

_TRUE = ("true", "1", "yes", "on")

# key -> cached value (None = key absent in DB, fall back to DEFAULTS).
_cache: dict[str, str | None] = {}


def get_setting(db, key, default=None):
    if key in _cache:
        return _cache[key]
    s = db.query(Setting).filter(Setting.key == key).first()
    value = s.value if s else default
    _cache[key] = value
    return value


def get_setting_ns(key: str, default: str | None = None) -> str | None:
    """Cache-only read for code paths without a Session (middleware,
    async webhook sender, Pydantic validators). Defaults are warmed at
    startup, so a missing key here means the caller's default."""
    if key in _cache:
        return _cache[key]
    return default


def get_int(db, key: str, default: int) -> int:
    """Integer setting; a corrupt/absent value falls back to the default."""
    raw = get_setting(db, key, None) if db is not None else get_setting_ns(key, None)
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


def get_int_ns(key: str, default: int) -> int:
    raw = get_setting_ns(key, None)
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


def set_setting(db, key, value):
    """Create or overwrite a setting (used by admin toggles)."""
    raw = str(value)
    s = db.query(Setting).filter(Setting.key == key).first()
    if s:
        s.value = raw
    else:
        s = Setting(key=key, value=raw)
        db.add(s)
    db.commit()
    db.refresh(s)
    _cache[key] = raw
    return s


def ensure_setting(db, key, value):
    """Insert a default only if the key does not exist yet."""
    if db.query(Setting).filter(Setting.key == key).first() is None:
        db.add(Setting(key=key, value=str(value)))
        db.commit()
        _cache[key] = str(value)


def ensure_defaults(db) -> None:
    """Seed every tunable from DEFAULTS and warm the cache (startup)."""
    for key, value in DEFAULTS.items():
        ensure_setting(db, key, value)
    # Existing keys still need to land in the cache.
    for key in DEFAULTS:
        if key not in _cache:
            get_setting(db, key, None)


def get_bool(db, key, default=True):
    v = get_setting(db, key, None)
    if v is None:
        return default
    return str(v).strip().lower() in _TRUE
