"""Application entrypoint.

Builds a FastAPI app (the JSON API mounted at /api), adds the MCP SSE routes
and serves the built frontend as static files. The Starlette app exposed as
``starlette_app`` is what the container runs.
"""
import asyncio
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

from . import models  # noqa: F401  (ensures models are registered)
from .config import settings
from .site_settings import (
    ensure_defaults,
    get_int,
    get_int_ns,
    get_setting_ns,
)
from .db import Base, SessionLocal, engine
from .routers import admin, auth, boards, currencies, lists, mcp, summary, tags, tasks

Base.metadata.create_all(bind=engine)

logger = logging.getLogger(__name__)


def _rebuild_money_tables() -> None:
    """§5.2: денежные суммы — INTEGER (копейки) вместо FLOAT.

    SQLite не умеет менять тип колонки — таблица пересоздаётся по принятому
    в проекту паттерну (tags/task_lists): копия → rename → индексы. Данные
    конвертируются ×100. Идемпотентность — по фактическому типу колонки:
    после пересоздания он INTEGER, и повторные запуски пропускают таблицу.
    """
    from sqlalchemy import inspect as _inspect
    from sqlalchemy import text

    plans = {
        "tasks": {"amount"},
        "task_cycle_logs": {"planned_amount", "actual_amount"},
    }
    money_types = {"FLOAT", "REAL", "DOUBLE", "NUMERIC", "DECIMAL"}
    inspector = _inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table, money_cols in plans.items():
        if table not in existing_tables:
            continue
        columns = inspector.get_columns(table)
        # inspector может вернуть type как строку, так и объект типа SQLAlchemy.
        ctype_of = {c["name"]: str(c["type"] or "").upper() for c in columns}
        convertible = {
            c["name"]
            for c in columns
            if c["name"] in money_cols and ctype_of[c["name"]] in money_types
        }
        if not convertible:
            continue
        with engine.begin() as conn:
            index_rows = conn.execute(
                text(
                    "SELECT name, sql FROM sqlite_master "
                    "WHERE type='index' AND tbl_name=:t AND sql IS NOT NULL"
                ),
                {"t": table},
            ).fetchall()
        with engine.begin() as conn:
            col_ddl, col_names, select_cols = [], [], []
            for c in columns:
                name = c["name"]
                is_money = name in convertible
                ctype = "INTEGER" if is_money else str(c["type"] or "")
                parts = [f'"{name}"', ctype]
                if c.get("primary_key"):
                    parts.append("PRIMARY KEY")
                if c.get("nullable") is False and not c.get("primary_key"):
                    parts.append("NOT NULL")
                if c.get("default") is not None:
                    parts.append(f"DEFAULT {c['default']}")
                col_ddl.append(" ".join(parts))
                col_names.append(f'"{name}"')
                if is_money:
                    select_cols.append(
                        f'CAST(ROUND(COALESCE("{name}", 0) * 100) AS INTEGER)'
                    )
                else:
                    select_cols.append(f'"{name}"')
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}_new"'))
            conn.execute(text(f'CREATE TABLE "{table}_new" ({", ".join(col_ddl)})'))
            conn.execute(
                text(
                    f'INSERT INTO "{table}_new" ({", ".join(col_names)}) '
                    f'SELECT {", ".join(select_cols)} FROM "{table}"'
                )
            )
            for name, _sql in index_rows:
                conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
            conn.execute(text(f'DROP TABLE "{table}"'))
            conn.execute(text(f'ALTER TABLE "{table}_new" RENAME TO "{table}"'))
            for _name, sql in index_rows:
                if sql:
                    conn.execute(text(sql))


def run_migrations() -> None:
    """Make existing SQLite databases match the current schema.

    `create_all` only creates tables that are missing, it never adds new
    columns to an existing table, so we patch older databases here.
    """
    from sqlalchemy import inspect, text

    from .site_settings import ensure_setting

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for name in (
        "boards",
        "settings",
        "task_dependencies",
        "task_tags",
        "task_cycle_logs",
    ):
        if name not in existing_tables:
            Base.metadata.tables[name].create(bind=engine)

    # Учёт регулярных платежей (ТЗ «Реформа циклических задач»): история
    # итераций получает фактические дату/сумму и привязку к доске.
    with engine.connect() as conn:
        log_cols = {c["name"] for c in inspector.get_columns("task_cycle_logs")}
        for col, ddl in (
            ("board_id", "INTEGER"),
            ("planned_amount", "FLOAT"),
            ("actual_amount", "FLOAT"),
            ("actual_date", "DATETIME"),
            ("currency_id", "INTEGER"),
        ):
            if col not in log_cols:
                conn.execute(text(f"ALTER TABLE task_cycle_logs ADD COLUMN {col} {ddl}"))
        conn.commit()

    with engine.connect() as conn:
        cols = {c["name"] for c in inspector.get_columns("tasks")}
        if "start_date" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN start_date DATETIME"))
        if "list" not in cols:
            conn.execute(text('ALTER TABLE tasks ADD COLUMN "list" VARCHAR'))
        for col, ddl in (
            ("is_cyclic", "BOOLEAN DEFAULT 0"),
            ("cycle_period", "VARCHAR"),
            ("cycle_interval", "INTEGER DEFAULT 1"),
            ("cycle_group_id", "VARCHAR"),
            ("reminder_days", "INTEGER DEFAULT 0"),
            ("amount", "FLOAT DEFAULT 0.0"),
        ):
            if col not in cols:
                conn.execute(text(f"ALTER TABLE tasks ADD COLUMN {col} {ddl}"))
        # Backfill rows that predate the "list" column (they are NULL).
        conn.execute(text('UPDATE tasks SET "list" = \'Входящие\' WHERE "list" IS NULL'))
        # NULL amount breaks TaskResponse validation (legacy rows predate the column).
        conn.execute(text('UPDATE tasks SET amount = 0.0 WHERE amount IS NULL'))
        conn.commit()

    # Long-lived MCP API key column on the users table.
    with engine.connect() as conn:
        user_cols = {c["name"] for c in inspector.get_columns("users")}
        if "mcp_token_hash" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN mcp_token_hash VARCHAR"))
            conn.commit()

    # Admin toggle: per-user webhook allowance (older users keep webhooks).
    with engine.connect() as conn:
        user_cols = {c["name"] for c in inspector.get_columns("users")}
        if "webhooks_enabled" not in user_cols:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN webhooks_enabled BOOLEAN DEFAULT 1")
            )
            conn.commit()

    # One webhook per board: drop duplicates (keep the lowest id) and add a
    # unique index. A plain index is used because the column is nullable
    # and NULL board_ids (legacy rows) must not collide.
    with engine.begin() as conn:
        conn.execute(
            text(
                "DELETE FROM webhooks WHERE id NOT IN "
                "(SELECT MIN(id) FROM webhooks WHERE board_id IS NOT NULL "
                "GROUP BY board_id) AND board_id IS NOT NULL"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_webhooks_board_id "
                "ON webhooks (board_id) WHERE board_id IS NOT NULL"
            )
        )

    # Multi-board support: boards table + board_id on tasks/tags/task_lists/
    # webhooks. Legacy rows are assigned to the user's default board.
    from sqlalchemy import inspect as _inspect

    board_cols = {c["name"] for c in _inspect(engine).get_columns("boards")}
    if not board_cols:
        Base.metadata.tables["boards"].create(bind=engine)
    if not _inspect(engine).has_table("task_change_logs"):
        Base.metadata.tables["task_change_logs"].create(bind=engine)
    for table in ("tasks", "tags", "task_lists", "webhooks"):
        with engine.connect() as conn:
            cols = {c["name"] for c in inspector.get_columns(table)}
            if "board_id" not in cols:
                conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN board_id INTEGER")
                )
                conn.commit()
    with engine.begin() as conn:
        for table in ("tasks", "tags", "task_lists", "webhooks"):
            conn.execute(
                text(
                    f"CREATE INDEX IF NOT EXISTS ix_{table}_board_id "
                    f"ON {table} (board_id)"
                )
            )
    # Multi-currency budget: currencies table + currency_id on tasks and
    # report_currency_id on boards. Base currency is USD (rate = 1.0).
    if "currencies" not in existing_tables:
        Base.metadata.tables["currencies"].create(bind=engine)
    with engine.connect() as conn:
        cols = {c["name"] for c in inspector.get_columns("tasks")}
        if "currency_id" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN currency_id INTEGER"))
            conn.commit()
        board_cols = {c["name"] for c in inspector.get_columns("boards")}
        if "report_currency_id" not in board_cols:
            conn.execute(
                text("ALTER TABLE boards ADD COLUMN report_currency_id INTEGER")
            )
            conn.commit()
        # Порядок валют (первая в списке = валюта по умолчанию). Бэкфилл:
        # USD — первым, остальные по id.
        cur_cols = {c["name"] for c in inspector.get_columns("currencies")}
        if "position" not in cur_cols:
            conn.execute(
                text("ALTER TABLE currencies ADD COLUMN position INTEGER DEFAULT 0")
            )
            conn.execute(
                text(
                    "UPDATE currencies SET position = CASE WHEN code = 'USD' THEN 0 "
                    "ELSE 1 + (SELECT COUNT(*) FROM currencies c2 "
                    "WHERE c2.user_id = currencies.user_id AND c2.code = 'USD') "
                    "+ (SELECT COUNT(*) FROM currencies c3 "
                    "WHERE c3.user_id = currencies.user_id AND c3.code <> 'USD' "
                    "AND c3.id < currencies.id)"
                )
            )
            conn.commit()
    with engine.begin() as conn:
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_tasks_currency_id ON tasks (currency_id)")
        )

    # Horizontal kanban (ТЗv2 §1.4): per-card position inside its list.
    # Fractional float — reordering inserts between neighbours without a
    # column-wide renumber. Backfill keeps the legacy deadline-first order.
    with engine.connect() as conn:
        cols = {c["name"] for c in inspector.get_columns("tasks")}
        if "position" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN position FLOAT NOT NULL DEFAULT 0.0"))
            conn.commit()
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE tasks SET position = "
                "(SELECT COALESCE(MAX(t2.position), 0) + 1024.0 FROM tasks t2 "
                " WHERE t2.user_id = tasks.user_id AND t2.board_id IS tasks.board_id "
                "   AND t2.\"list\" = tasks.\"list\" AND t2.id < tasks.id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_tasks_list_position "
                "ON tasks (user_id, board_id, \"list\", position)"
            )
        )

    _backfill_boards()
    _backfill_cycle_log_boards()

    # Tags + task_lists rebuilds: the multi-board schema scopes name uniqueness
    # to (user_id, board_id) instead of (user_id, name); SQLite needs a rebuild.
    # Fresh inspector: the cached one may miss columns added above (board_id).
    inspector = _inspect(engine)
    for table, index_name in (
        ("tags", "uq_tags_user_board_name"),
        ("task_lists", "uq_task_lists_user_board_name"),
    ):
        existing_indexes = {i["name"] for i in inspector.get_indexes(table)}
        if index_name in existing_indexes:
            continue
        with engine.begin() as conn:
            cols = ", ".join(
                f"{c['name']} {c['type']}"
                + (" PRIMARY KEY" if c.get("primary_key") else "")
                for c in inspector.get_columns(table)
            )
            conn.execute(text(f"DROP TABLE IF EXISTS {table}_new"))
            conn.execute(
                text(
                    f"CREATE TABLE {table}_new ({cols})"
                )
            )
            conn.execute(
                text(f"INSERT INTO {table}_new SELECT * FROM {table}")
            )
            for idx in inspector.get_indexes(table):
                conn.execute(text(f"DROP INDEX IF EXISTS {idx['name']}"))
            conn.execute(text(f"DROP TABLE {table}"))
            conn.execute(text(f"ALTER TABLE {table}_new RENAME TO {table}"))
            conn.execute(text(f"CREATE INDEX ix_{table}_name ON {table} (name)"))
            conn.execute(text(f"CREATE INDEX ix_{table}_user_id ON {table} (user_id)"))
            conn.execute(text(f"CREATE INDEX ix_{table}_board_id ON {table} (board_id)"))
            conn.execute(
                text(
                    f"CREATE UNIQUE INDEX {index_name} "
                    f"ON {table} (user_id, board_id, name)"
                )
            )

    # Per-user tags: add user_id to tags, backfill it from the owning task
    # and rebuild the table if it still has a global UNIQUE(name) constraint.
    if "tags" in existing_tables:
        tag_cols = {c["name"] for c in inspector.get_columns("tags")}
        with engine.connect() as conn:
            needs_rebuild = "user_id" not in tag_cols
            if needs_rebuild:
                conn.execute(text("ALTER TABLE tags ADD COLUMN user_id INTEGER"))
                conn.commit()
            # Backfill user_id from any task carrying the tag.
            conn.execute(
                text(
                    "UPDATE tags SET user_id = ("
                    "  SELECT t.user_id FROM task_tags tt"
                    "  JOIN tasks t ON t.id = tt.task_id"
                    "  WHERE tt.tag_id = tags.id LIMIT 1)"
                    " WHERE user_id IS NULL"
                )
            )
            conn.commit()
        # SQLite cannot drop a UNIQUE(name) constraint without a table rebuild.
        # The old schema had a column-level UNIQUE, implemented via an unnamed
        # auto-index invisible to the inspector — so whenever the migration
        # added user_id, we rebuild unconditionally.
        if needs_rebuild:
            with engine.begin() as conn:
                conn.execute(text("DROP TABLE IF EXISTS tags_new"))
                conn.execute(
                    text(
                        "CREATE TABLE tags_new ("
                        "id INTEGER PRIMARY KEY, "
                        "name VARCHAR, "
                        "user_id INTEGER REFERENCES users (id), "
                        "color VARCHAR DEFAULT '#64748b')"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO tags_new (id, name, user_id, color) "
                        "SELECT id, name, user_id, color FROM tags"
                    )
                )
                conn.execute(text("DROP INDEX IF EXISTS ix_tags_name"))
                conn.execute(text("DROP TABLE tags"))
                conn.execute(text("ALTER TABLE tags_new RENAME TO tags"))
                conn.execute(
                    text("CREATE INDEX ix_tags_name ON tags (name)")
                )
                conn.execute(
                    text("CREATE INDEX ix_tags_user_id ON tags (user_id)")
                )
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX uq_tags_user_name "
                        "ON tags (user_id, name)"
                    )
                )
            # Drop tags left without an owner (orphans predating the migration).
            with engine.begin() as conn:
                conn.execute(text("DELETE FROM tags WHERE user_id IS NULL"))

    # Per-user board lists: task_lists historically was a global table with a
    # UNIQUE(name) constraint. Add user_id, copy each existing list for every
    # user and rebuild the table to drop the global uniqueness.
    if "task_lists" in existing_tables:
        tl_cols = {c["name"] for c in inspector.get_columns("task_lists")}
        if "user_id" not in tl_cols:
            with engine.begin() as conn:
                conn.execute(text("DROP TABLE IF EXISTS task_lists_new"))
                conn.execute(
                    text(
                        "CREATE TABLE task_lists_new ("
                        "id INTEGER PRIMARY KEY, "
                        "name VARCHAR, "
                        "user_id INTEGER REFERENCES users (id), "
                        "color VARCHAR DEFAULT '#64748b', "
                        "position INTEGER DEFAULT 0, "
                        "is_default BOOLEAN DEFAULT 0, "
                        "kind VARCHAR)"
                    )
                )
                # Copy every global list for every user.
                conn.execute(
                    text(
                        "INSERT INTO task_lists_new (name, user_id, color, position, is_default, kind) "
                        "SELECT l.name, u.id, l.color, l.position, l.is_default, l.kind "
                        "FROM task_lists l CROSS JOIN users u"
                    )
                )
                conn.execute(text("DROP INDEX IF EXISTS ix_task_lists_name"))
                conn.execute(text("DROP TABLE task_lists"))
                conn.execute(text("ALTER TABLE task_lists_new RENAME TO task_lists"))
                conn.execute(
                    text("CREATE INDEX ix_task_lists_name ON task_lists (name)")
                )
                conn.execute(
                    text("CREATE INDEX ix_task_lists_user_id ON task_lists (user_id)")
                )
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX uq_task_lists_user_name "
                        "ON task_lists (user_id, name)"
                    )
                )

    # §5.2: денежные суммы → копейки (таблицы пересоздаются, если ещё FLOAT).
    _rebuild_money_tables()

    db = SessionLocal()
    try:
        ensure_setting(db, "allow_registration", "true")
        ensure_admin(db)
        seed_lists(db)
        seed_boards(db)
        migrate_legacy_tags(db)
        seed_currencies(db)
    finally:
        db.close()


def _backfill_cycle_log_boards() -> None:
    """Re-bind orphaned cycle-history entries to their cycle's current board.

    Legacy entries (written before cycle logs carried board_id, e.g. the
    OZON instalment payment of 19.10.2026) have board_id = NULL and were
    invisible on the board's cash-flow chart. The board is restored from
    any live task of the same cycle_group_id (the iteration the user sees
    today); when the cycle is already dead, the owner's default board is
    used — same fallback as _backfill_boards for tasks.
    """
    from sqlalchemy import text

    from .models import TaskCycleLog

    with SessionLocal() as db:
        # 1) группы, у которых есть живая задача — берём её доску
        for log_id, group_id, uid in db.execute(
            text(
                "SELECT l.id, l.cycle_group_id, l.user_id "
                "FROM task_cycle_logs l "
                "WHERE l.board_id IS NULL AND l.cycle_group_id IS NOT NULL"
            )
        ).all():
            board_id = db.execute(
                text(
                    "SELECT board_id FROM tasks "
                    "WHERE user_id = :uid AND cycle_group_id = :gid "
                    "AND board_id IS NOT NULL ORDER BY id LIMIT 1"
                ),
                {"uid": uid, "gid": group_id},
            ).scalar()
            if board_id is None:
                # 2) цикл уже прекращён — доска владельца по умолчанию
                board_id = db.execute(
                    text(
                        "SELECT id FROM boards WHERE user_id = :uid "
                        "ORDER BY id LIMIT 1"
                    ),
                    {"uid": uid},
                ).scalar()
            if board_id is not None:
                db.execute(
                    text(
                        "UPDATE task_cycle_logs SET board_id = :bid WHERE id = :lid"
                    ),
                    {"bid": board_id, "lid": log_id},
                )
        db.commit()
        # страховка: логи без привязки не должны остаться
        left = db.query(TaskCycleLog).filter(TaskCycleLog.board_id.is_(None)).count()
        if left:
            logger.warning("cycle-log board backfill: %d entries left unbound", left)


def _backfill_boards() -> None:
    """Assign every legacy row (board_id IS NULL) to the user's default board,
    creating that board when needed."""
    from sqlalchemy import text

    from .models import Board

    with SessionLocal() as db:
        for (uid,) in db.execute(text("SELECT id FROM users ORDER BY id")).all():
            board = (
                db.query(Board)
                .filter(Board.user_id == uid)
                .order_by(Board.id)
                .first()
            )
            if not board:
                board = Board(user_id=uid, name=f"Доска #{uid}", color="#0ea5e9")
                db.add(board)
                db.commit()
                db.refresh(board)
            for table in ("tasks", "tags", "task_lists", "webhooks"):
                db.execute(
                    text(
                        f"UPDATE {table} SET board_id = :bid "
                        "WHERE user_id = :uid AND board_id IS NULL"
                    ),
                    {"bid": board.id, "uid": uid},
                )
        db.commit()


def seed_boards(db) -> None:
    """Ensure every user has at least one board (post-migration safety net)."""
    from .board import ensure_default_board
    from .models import User

    for user in db.query(User).all():
        ensure_default_board(db, user.id)


def migrate_legacy_tags(db) -> None:
    """Move the old single `tasks.tag` value into the new task_tags join table."""
    from sqlalchemy import text

    from .board import PALETTE, list_colors
    from .models import Tag, task_tags

    rows = db.execute(
        text("SELECT id, tag, user_id FROM tasks WHERE tag IS NOT NULL AND tag <> ''")
    ).fetchall()
    for task_id, tag_name, task_user_id in rows:
        tag = (
            db.query(Tag)
            .filter(Tag.name == tag_name, Tag.user_id == task_user_id)
            .first()
        )
        if not tag:
            used = list_colors(db, task_user_id) | {
                t.color
                for t in db.query(Tag).filter(Tag.user_id == task_user_id).all()
            }
            color = next((c for c in PALETTE if c not in used), "#64748b")
            tag = Tag(name=tag_name, color=color, user_id=task_user_id)
            db.add(tag)
            db.commit()
            db.refresh(tag)
        exists = db.execute(
            text("SELECT 1 FROM task_tags WHERE task_id=:tid AND tag_id=:gid"),
            {"tid": task_id, "gid": tag.id},
        ).first()
        if not exists:
            db.execute(task_tags.insert().values(task_id=task_id, tag_id=tag.id))
    db.commit()


def seed_lists(db) -> None:
    """Ensure every user has their own protected default board lists (now
    including the system «Регулярные» list), and backfill tasks whose list
    does not reference one of the owner's lists."""
    from .board import ensure_default_lists, status_for_list, status_for_kind
    from .models import Board, Task, TaskList

    # Только существующие доски: у задач может не быть board_id до бэкфилла.
    for board in db.query(Board).all():
        ensure_default_lists(db, board.user_id, board.id)

    # Backfill tasks whose list does not reference one of the owner's lists,
    # and keep status consistent with the (new) list. Жёсткая связь
    # «циклическая ⇔ Регулярные» восстанавливается в обе стороны.
    for task in db.query(Task).all():
        owned = (
            db.query(TaskList)
            .filter(
                TaskList.user_id == task.user_id,
                TaskList.board_id == task.board_id,
                TaskList.name == task.list,
            )
            .first()
        )
        if not owned:
            task.list = "Не начато"
        if task.is_cyclic:
            regular = (
                db.query(TaskList)
                .filter(
                    TaskList.user_id == task.user_id,
                    TaskList.board_id == task.board_id,
                    TaskList.name == "Регулярные",
                )
                .first()
            )
            if regular:
                task.list = regular.name
                task.status = "todo"
                continue
        elif task.list == "Регулярные":
            fallback = (
                db.query(TaskList)
                .filter(
                    TaskList.user_id == task.user_id,
                    TaskList.board_id == task.board_id,
                    TaskList.name != "Регулярные",
                )
                .order_by(TaskList.position, TaskList.id)
                .first()
            )
            if fallback:
                task.list = fallback.name
                task.status = status_for_kind(fallback.kind)
                continue
        task.status = status_for_list(task.list)
    db.commit()


def seed_currencies(db) -> None:
    """Ensure every user has the default currency set (RUB/USD/EUR)."""
    from .models import User
    from .services.currency_service import ensure_default_currencies

    for user in db.query(User).all():
        ensure_default_currencies(db, user.id)


def ensure_admin(db) -> None:
    """Guarantee at least one admin exists.

    - If ADMIN_USERNAME is provided, that account is created (if missing) and
      promoted to admin.
    - Otherwise the first registered user is promoted when no admin exists yet.
    This lets the admin panel be reachable even on a fresh or pre-existing DB
    that has no admin (registration only ever creates 'user' accounts).
    """
    from .auth import get_password_hash
    from .models import User

    if db.query(User).filter(User.role == "admin").first():
        return

    admin_name = os.getenv("ADMIN_USERNAME")
    if admin_name:
        user = db.query(User).filter(User.username == admin_name).first()
        if not user:
            # Never fall back to a well-known default password: if none is
            # provided, generate a random one and show it once in the logs.
            password = os.getenv("ADMIN_PASSWORD")
            if not password:
                import secrets

                password = secrets.token_urlsafe(16)
                print(
                    f"[security] ADMIN_PASSWORD not set — one-time generated "
                    f"password for '{admin_name}': {password}"
                )
            user = User(
                username=admin_name,
                hashed_password=get_password_hash(password),
                role="admin",
            )
            db.add(user)
        else:
            user.role = "admin"
        db.commit()
        return

    first = db.query(User).order_by(User.id).first()
    if first:
        first.role = "admin"
        db.commit()


run_migrations()

# Remove orphan tags left by older versions (bulk updates used to skip cleanup).
# Must run after run_migrations(): on old databases tags.user_id does not exist yet.
from .routers.tags import cleanup_orphan_tags

with SessionLocal() as _db:
    cleanup_orphan_tags(_db)
    # Seed every admin-panel tunable (site_settings.DEFAULTS) and warm the
    # settings cache used by middleware / validators / the webhook sender.
    ensure_defaults(_db)

# --- JSON API (mounted at /api) ---
api = FastAPI(title="OmniTask API")

# DoS guard: reject oversized request bodies before they are buffered and
# parsed (Pydantic would otherwise happily eat hundreds of MBs). The cap is
# an admin-panel setting (max_body_mb), default 2 MB.
MAX_BODY_BYTES = 2 * 1024 * 1024  # fallback, overridden by the setting

# Maintenance flag + scheduler handle for admin.py (reschedule on change).
app_scheduler = None

_MAINTENANCE_OPEN = ("/health", "/auth/login", "/auth/registration-status")


@api.middleware("http")
async def _maintenance_mode(request, call_next):
    """Return 503 for everyone except admins while maintenance_mode is on.
    Health checks and the login page stay reachable so an admin can sign in.
    (MCP routes live outside this app and are not affected.)"""
    if get_setting_ns("maintenance_mode", "false") not in ("true", "1", "yes", "on"):
        return await call_next(request)
    path = request.url.path
    if any(path.endswith(p) for p in _MAINTENANCE_OPEN):
        return await call_next(request)
    auth_hdr = request.headers.get("authorization", "")
    token = auth_hdr[7:] if auth_hdr[:7].lower() == "bearer " else ""
    if token:
        from .auth import decode_access_token
        from .models import User

        payload = decode_access_token(token)
        if payload and payload.get("sub"):
            with SessionLocal() as db:
                user = (
                    db.query(User).filter(User.username == payload["sub"]).first()
                )
                if user is not None and user.role == "admin":
                    return await call_next(request)
    return JSONResponse(
        {"detail": "Сервис на обслуживании. Зайдите позже."}, status_code=503
    )


@api.middleware("http")
async def _body_size_limit(request, call_next):
    cl = request.headers.get("content-length", "")
    if cl.isdigit():
        limit_mb = get_int_ns("max_body_mb", 2)
        if int(cl) > max(1, limit_mb) * 1024 * 1024:
            return JSONResponse(
                {"detail": "Слишком большой запрос"}, status_code=413
            )
    return await call_next(request)


def _cors_middleware():
    """CORS only for origins explicitly listed in CORS_ORIGINS env.
    No wildcard: the app is same-origin (the frontend is served by the same
    container), so by default CORS is simply disabled."""
    if not settings["CORS_ORIGINS"]:
        return None
    return Middleware(
        CORSMiddleware,
        allow_origins=settings["CORS_ORIGINS"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


if (mw := _cors_middleware()) is not None:
    api.add_middleware(
        CORSMiddleware,
        allow_origins=settings["CORS_ORIGINS"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
api.include_router(auth.router)
api.include_router(boards.router)
api.include_router(tasks.router)
api.include_router(summary.router)
api.include_router(admin.router)
api.include_router(lists.router)
api.include_router(tags.router)
api.include_router(currencies.router)


@api.get("/health")
def health():
    return {"status": "ok", "version": settings["BUILD_VERSION"]}


@api.on_event("startup")
async def start_scheduler():
    """Capture the running loop for threadsafe webhook dispatch and start
    the background job that checks overdue / approaching deadlines."""
    from apscheduler.schedulers.asyncio import AsyncIOScheduler

    from .services import notification_service

    global app_scheduler
    notification_service.set_main_loop(asyncio.get_running_loop())
    with SessionLocal() as _db:
        scan_every = get_int(_db, "scheduler_interval_min", 30)
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        notification_service.check_due_tasks,
        trigger="interval",
        minutes=scan_every,
        id="check_due_tasks",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    app_scheduler = scheduler


# --- Static frontend serving ---
static_dir = os.getenv("STATIC_DIR", "/app/static")


class NoCacheStaticFiles(StaticFiles):
    """Disable caching for HTML and PWA service-worker files.

    Without no-store on ``sw.js`` the browser heuristically caches the old
    service worker, never sees the update, and keeps serving a stale precache
    (which caused the endless version-check reload loop).
    """

    NO_STORE_SUFFIXES = ("sw.js", "registerSW.js", "manifest.webmanifest")

    async def get_response(self, *args, **kwargs):
        resp = await super().get_response(*args, **kwargs)
        path = kwargs.get("path") or ""
        if "text/html" in (resp.media_type or "") or path.endswith(self.NO_STORE_SUFFIXES):
            resp.headers["Cache-Control"] = "no-store"
        return resp


starlette_app = Starlette(
    routes=[
        Mount("/api", app=api),
        *mcp.mcp_routes,
        Mount("/", app=NoCacheStaticFiles(directory=static_dir, html=True)),
    ],
    middleware=[mw] if mw else [],
)
