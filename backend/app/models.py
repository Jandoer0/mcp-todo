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

from .db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String, default="user")  # admin | user


# Self-referential many-to-many: a row (blocker_id, blocked_id) means the task
# with id == blocker_id blocks the task with id == blocked_id.
task_dependencies = Table(
    "task_dependencies",
    Base.metadata,
    Column("blocker_id", Integer, ForeignKey("tasks.id"), primary_key=True),
    Column("blocked_id", Integer, ForeignKey("tasks.id"), primary_key=True),
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
    tag = Column(String, nullable=True)
    list = Column(String, default="Входящие")  # задел под Канбан-доску
    created_at = Column(DateTime, default=datetime.utcnow)


class Setting(Base):
    """Key/value store for site-wide settings (e.g. allow_registration)."""

    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    value = Column(String, nullable=True)
