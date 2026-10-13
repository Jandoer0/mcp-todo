"""SQLAlchemy ORM models."""
from .clock import utcnow

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
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
    created_at = Column(DateTime, default=utcnow)

    # Cyclic task support: a repeating task regenerates itself on completion.
    is_cyclic = Column(Boolean, default=False)
    cycle_period = Column(String, nullable=True)  # daily | weekly | monthly | yearly
    cycle_interval = Column(Integer, default=1)  # every N periods
    cycle_group_id = Column(String, nullable=True, index=True)  # iteration chain id
    reminder_days = Column(Integer, default=0)  # visible N days before deadline

    tags = relationship(
        "Tag", secondary=task_tags, backref="tasks", order_by="Tag.name"
    )


class TaskCycleLog(Base):
    """History of finished cyclic-task iterations.

    When a cyclic iteration is completed it is removed from the board and
    logged here; skipping is silent and logs nothing; stopping the cycle is
    logged with action='stopped'."""

    __tablename__ = "task_cycle_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    cycle_group_id = Column(String, index=True)
    task_title = Column(String)
    action = Column(String)  # completed | stopped
    deadline = Column(DateTime, nullable=True)  # deadline of that iteration
    logged_at = Column(DateTime, default=utcnow)


class TaskList(Base):
    """A board column. The task's `list` field stores the list name.
    Lists are strictly per-user; the same name may exist for different users."""

    __tablename__ = "task_lists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    color = Column(String, default="#64748b")
    position = Column(Integer, default=0)
    is_default = Column(Boolean, default=False)
    # 'done' | 'progress' | 'todo' — semantics of the protected default lists
    kind = Column(String, nullable=True)
    __table_args__ = (
        # Uniqueness of a list name is scoped to its owner.
        UniqueConstraint("user_id", "name", name="uq_task_lists_user_name"),
    )


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    # Tags are strictly per-user: the same name may exist for different users.
    name = Column(String, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    color = Column(String, default="#64748b")
    __table_args__ = (
        # Uniqueness of a tag name is scoped to its owner.
        UniqueConstraint("user_id", "name", name="uq_tags_user_name"),
    )


class Webhook(Base):
    """Outgoing webhook: POSTs task-event notifications to an external
    receiver (e.g. the Hermes Agent Gateway). Owned by a user; only that
    user's task events are dispatched to it."""

    __tablename__ = "webhooks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    name = Column(String)  # internal label, e.g. "Уведомления Лоры"
    url = Column(String)  # receiver endpoint
    token = Column(String, nullable=True)  # HMAC secret for signing the body
    chat_id = Column(String)  # Telegram target chat id
    thread_id = Column(String, nullable=True)  # Telegram topic/thread id
    events = Column(JSON, default=list)  # enabled event types
    excluded_events = Column(JSON, default=list)  # always ignored event types
    created_at = Column(DateTime, default=utcnow)

    def event_enabled(self, event: str) -> bool:
        """Excluded events always win over the enabled set."""
        excluded = self.excluded_events or []
        if event in excluded:
            return False
        return event in (self.events or [])


class Setting(Base):
    """Key/value store for site-wide settings (e.g. allow_registration)."""

    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    value = Column(String, nullable=True)
