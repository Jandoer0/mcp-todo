"""Application entrypoint.

Builds a FastAPI app (the JSON API mounted at /api), adds the MCP SSE routes
and serves the built frontend as static files. The Starlette app exposed as
``starlette_app`` is what the container runs.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import FileResponse, HTMLResponse
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

from . import models  # noqa: F401  (ensures models are registered)
from .config import settings
from .db import Base, SessionLocal, engine
from .routers import admin, auth, lists, mcp, summary, tags, tasks

Base.metadata.create_all(bind=engine)


def run_migrations() -> None:
    """Make existing SQLite databases match the current schema.

    `create_all` only creates tables that are missing, it never adds new
    columns to an existing table, so we patch older databases here.
    """
    from sqlalchemy import inspect, text

    from .site_settings import ensure_setting

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for name in ("settings", "task_dependencies", "task_tags", "task_cycle_logs"):
        if name not in existing_tables:
            Base.metadata.tables[name].create(bind=engine)

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
        ):
            if col not in cols:
                conn.execute(text(f"ALTER TABLE tasks ADD COLUMN {col} {ddl}"))
        # Backfill rows that predate the "list" column (they are NULL).
        conn.execute(text('UPDATE tasks SET "list" = \'Входящие\' WHERE "list" IS NULL'))
        conn.commit()

    # Long-lived MCP API key column on the users table.
    with engine.connect() as conn:
        user_cols = {c["name"] for c in inspector.get_columns("users")}
        if "mcp_token_hash" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN mcp_token_hash VARCHAR"))
            conn.commit()

    db = SessionLocal()
    try:
        ensure_setting(db, "allow_registration", "true")
        ensure_admin(db)
        seed_lists(db)
        migrate_legacy_tags(db)
    finally:
        db.close()


def migrate_legacy_tags(db) -> None:
    """Move the old single `tasks.tag` value into the new task_tags join table."""
    from sqlalchemy import text

    from .board import PALETTE, list_colors
    from .models import Tag, Task, task_tags

    rows = db.execute(
        text("SELECT id, tag FROM tasks WHERE tag IS NOT NULL AND tag <> ''")
    ).fetchall()
    for task_id, tag_name in rows:
        tag = db.query(Tag).filter(Tag.name == tag_name).first()
        if not tag:
            used = list_colors(db) | {t.color for t in db.query(Tag).all()}
            color = next((c for c in PALETTE if c not in used), "#64748b")
            tag = Tag(name=tag_name, color=color)
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
    """Create the protected default board lists on first run."""
    from .board import DEFAULT_LISTS, status_for_list
    from .models import Task, TaskList

    existing = {l.name for l in db.query(TaskList.name).all()}
    for spec in DEFAULT_LISTS:
        if spec["name"] not in existing:
            db.add(
                TaskList(
                    name=spec["name"],
                    color=spec["color"],
                    position=spec["position"],
                    is_default=True,
                    kind=spec["kind"],
                )
            )
    db.commit()
    # Backfill tasks whose list does not reference an existing list, and
    # keep status consistent with the (new) list.
    valid = {l.name for l in db.query(TaskList.name).all()}
    for task in db.query(Task).all():
        if task.list not in valid:
            task.list = "Не начато"
        task.status = status_for_list(task.list)
    db.commit()


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
            user = User(
                username=admin_name,
                hashed_password=get_password_hash(os.getenv("ADMIN_PASSWORD", "admin")),
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

# --- JSON API (mounted at /api) ---
api = FastAPI(title="OmniTask API")
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
api.include_router(auth.router)
api.include_router(tasks.router)
api.include_router(summary.router)
api.include_router(admin.router)
api.include_router(lists.router)
api.include_router(tags.router)


@api.get("/health")
def health():
    return {"status": "ok", "version": settings["BUILD_VERSION"]}


# --- Static frontend serving ---
static_dir = os.getenv("STATIC_DIR", "/app/static")


class NoCacheStaticFiles(StaticFiles):
    """Disable caching for HTML so new frontend builds are always picked up."""

    async def get_response(self, *args, **kwargs):
        resp = await super().get_response(*args, **kwargs)
        if "text/html" in (resp.media_type or ""):
            resp.headers["Cache-Control"] = "no-store"
        return resp


async def serve_frontend(request):
    path = request.path_params.get("path", "index.html")
    full = os.path.join(static_dir, path)
    if os.path.exists(full) and os.path.isfile(full):
        return FileResponse(full)
    index = os.path.join(static_dir, "index.html")
    if os.path.exists(index):
        return FileResponse(index, media_type="text/html")
    return HTMLResponse("<h1>OmniTask</h1><p>Frontend not built.</p>")


starlette_app = Starlette(
    routes=[
        Mount("/api", app=api),
        *mcp.mcp_routes,
        Mount("/", app=NoCacheStaticFiles(directory=static_dir, html=True)),
    ],
    middleware=[
        # Allow cross-origin access to the SSE/MCP endpoints so browser-based
        # MCP clients (and the agent's tool_search) can connect from any origin.
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    ],
)
