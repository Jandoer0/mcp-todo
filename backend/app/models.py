"""SQLAlchemy ORM models."""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String, default="user")  # admin | user
    # Long-lived API key for the agent (MCP). Stores a SHA-256 hash of the
    # token; the raw token is only ever returned once, at generation time.
    mcp_token_hash = Column(String, nullable=True)


# Self-referential many-to-many: a row (blocker_id, blocked_id) means the task
# with id == blocker_id blocks the task with id == blocked_id.
task_dependencies = Table(
    "task_dependencies",
    Base.metadata,
    Column("blocker_id", Integer, ForeignKey("tasks.id"), primary_key=True),
    Column("blocked_id", Integer, ForeignKey("tasks.id"), primary_key=True),
)

# Many-to-many: a task may carry several tags.
task_tags = Table(
    "task_tags",
    Base.metadata,
    Column("task_id", Integer, ForeignKey("tasks.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True),
)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String)
    description = Column(Text, nullable=True)
    start_date = Column(DateTime, nullable=True)
    deadline = Column(DateTime, nullable=True)
    priority = Column(Integer, default=1)  # 1 low, 2 medium, 3 high
    status = Column(String, default="todo")  # todo | in_progress | done
    tag = Column(String, nullable=True)  # legacy single-tag column (unused)
    list = Column(String, default="Входящие")  # задел под Канбан-доску
    created_at = Column(DateTime, default=datetime.utcnow)

    tags = relationship(
        "Tag", secondary=task_tags, backref="tasks", order_by="Tag.name"
    )


class TaskList(Base):
    """A board column. The task's `list` field stores the list name."""

    __tablename__ = "task_lists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    color = Column(String, default="#64748b")
    position = Column(Integer, default=0)
    is_default = Column(Boolean, default=False)
    # 'done' | 'progress' | 'todo' — semantics of the protected default lists
    kind = Column(String, nullable=True)


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    color = Column(String, default="#64748b")


class Setting(Base):
    """Key/value store for site-wide settings (e.g. allow_registration)."""

    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    value = Column(String, nullable=True)
