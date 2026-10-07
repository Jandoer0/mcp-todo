"""Site-wide settings stored in the DB (simple key/value store)."""
from .models import Setting


def get_setting(db, key, default=None):
    s = db.query(Setting).filter(Setting.key == key).first()
    return s.value if s else default


def set_setting(db, key, value):
    """Create or overwrite a setting (used by admin toggles)."""
    s = db.query(Setting).filter(Setting.key == key).first()
    if s:
        s.value = str(value)
    else:
        s = Setting(key=key, value=str(value))
        db.add(s)
    db.commit()
    db.refresh(s)
    return s


def ensure_setting(db, key, value):
    """Insert a default only if the key does not exist yet."""
    if db.query(Setting).filter(Setting.key == key).first() is None:
        db.add(Setting(key=key, value=str(value)))
        db.commit()


def get_bool(db, key, default=True):
    v = get_setting(db, key, None)
    if v is None:
        return default
    return str(v).strip().lower() in ("true", "1", "yes", "on")
