import builtins
import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, computed_field, field_validator

from .security import validate_webhook_url

# Shared limits: the SQLite columns are unbounded VARCHARs, so schemas are
# the only guard against absurd values (DB bloat / UI breakage / DoS).
MAX_TITLE = 200
MAX_DESCRIPTION = 50_000
MAX_LIST_NAME = 100
MAX_TAG_NAME = 50
_MAX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _check_color(v: str | None) -> str | None:
    if v is None:
        return v
    if not _MAX_COLOR.match(v or ""):
        raise ValueError("Цвет должен быть в формате #rrggbb")
    return v


def _check_kind(v: str | None) -> str | None:
    if v is not None and v not in ("todo", "progress", "done"):
        raise ValueError("kind должен быть todo, progress или done")
    return v


class BoardResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    color: str
    position: int

    model_config = {"from_attributes": True}

class BoardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    color: str = "#0ea5e9"

    _color_check = field_validator("color")(_check_color)

class BoardUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = None
    position: int | None = Field(default=None, ge=0, le=1_000_000)

    _color_check = field_validator("color")(_check_color)

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    webhooks_enabled: bool = True
    # Stored hashed token is never serialized; only expose whether one is set.
    mcp_token_hash: str | None = Field(default=None, exclude=True)

    model_config = {"from_attributes": True, "extra": "ignore"}

    @computed_field
    @property
    def has_mcp_token(self) -> bool:
        return bool(self.mcp_token_hash)

class UserCreate(BaseModel):
    # min password length is enforced in /auth/register (admin updates may
    # send an empty password meaning "keep the current one").
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(default="", max_length=256)
    role: str | None = "user"
    webhooks_enabled: bool | None = None

class Token(BaseModel):
    access_token: str
    token_type: str

class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION)
    list: str | None = Field(default="Входящие", max_length=MAX_LIST_NAME)
    start_date: datetime | None = None
    deadline: datetime | None = None
    priority: int | None = Field(default=1, ge=1, le=3)
    tags: builtins.list[str] | None = []
    # Owning board (required for creation; verified server-side)
    board_id: int | None = None
    # Blocking tasks (ids of tasks that must be done before this one)
    blocked_by: builtins.list[int] | None = None
    # Cyclic task settings
    is_cyclic: bool | None = False
    cycle_period: str | None = None  # daily | weekly | monthly | yearly
    cycle_interval: int | None = Field(default=1, ge=1, le=365)
    reminder_days: int | None = Field(default=0, ge=0, le=365)
    # Financial weight: positive = income, negative = expense (0 = no budget)
    amount: float | None = Field(default=0.0, allow_inf_nan=False, ge=-1e12, le=1e12)

    @field_validator("cycle_period")
    @classmethod
    def _cycle_period_check(cls, v: str | None) -> str | None:
        if v is not None and v not in ("daily", "weekly", "monthly", "yearly"):
            raise ValueError("cycle_period: daily | weekly | monthly | yearly")
        return v

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    list: str | None = None
    start_date: datetime | None = None
    deadline: datetime | None = None
    priority: int | None = None
    tags: builtins.list[str] | None = None
    blocked_by: builtins.list[int] | None = None
    # Cyclic task settings
    is_cyclic: bool | None = None
    cycle_period: str | None = None
    cycle_interval: int | None = None
    reminder_days: int | None = None
    amount: float | None = None

class TagResponse(BaseModel):
    id: int
    name: str
    color: str

    model_config = {"from_attributes": True}

class TaskListResponse(BaseModel):
    id: int
    name: str
    color: str
    position: int
    # Semantics of protected default lists: 'todo' | 'progress' | 'done'
    kind: str | None = None

    model_config = {"from_attributes": True}

class TaskListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_LIST_NAME)
    color: str | None = None
    position: int | None = Field(default=None, ge=0, le=1_000_000)
    # 'todo' | 'progress' | 'done' | None (regular list)
    kind: str | None = None

    _color_check = field_validator("color")(_check_color)
    _kind_check = field_validator("kind")(_check_kind)

class TaskListUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=MAX_LIST_NAME)
    color: str | None = None
    position: int | None = Field(default=None, ge=0, le=1_000_000)
    kind: str | None = None

    _color_check = field_validator("color")(_check_color)
    _kind_check = field_validator("kind")(_check_kind)

class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_TAG_NAME)
    color: str

    _color_check = field_validator("color")(_check_color)

class TagUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=MAX_TAG_NAME)
    color: str | None = None

    _color_check = field_validator("color")(_check_color)

class TaskResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    list: str
    board_id: int | None = None
    start_date: datetime | None = None
    deadline: datetime | None = None
    priority: int
    tags: list[str] = []
    created_at: datetime
    blocked_by: list[int] = []
    is_blocked: bool = False
    # Cyclic task info
    is_cyclic: bool = False
    cycle_period: str | None = None
    cycle_interval: int | None = 1
    cycle_group_id: str | None = None
    reminder_days: int | None = 0
    cycle_dormant: bool = False  # cyclic task outside its reminder window
    amount: float = 0.0  # financial weight (income + / expense -)

    model_config = {"from_attributes": True}

    @field_validator("amount", mode="before")
    @classmethod
    def _amount_default(cls, v):
        # Legacy rows may carry NULL (column added by migration) — treat as 0.
        return 0.0 if v is None else v

    @field_validator("tags", mode="before")
    @classmethod
    def validate_tags(cls, v):
        if isinstance(v, list):
            return [tag.name if hasattr(tag, "name") else str(tag) for tag in v]
        return v

class SummaryResponse(BaseModel):
    total: int
    todo: int
    in_progress: int
    done: int
    overdue: int
    planned: int = 0

class SettingsResponse(BaseModel):
    allow_registration: bool
    db_size_limit_mb: int = 0


class ServerStatsResponse(BaseModel):
    db: int
    wal: int
    total: int
    db_size_limit_mb: int
    uptime_seconds: int
    counts: dict[str, int]

class TaskChangeLogResponse(BaseModel):
    id: int
    field: str
    old_value: str | None = None
    new_value: str | None = None
    changed_at: datetime

    model_config = {"from_attributes": True}


class CycleLogResponse(BaseModel):
    id: int
    task_title: str
    action: str
    deadline: datetime | None = None
    logged_at: datetime

    model_config = {"from_attributes": True}

class TaskBulkUpdate(BaseModel):
    # Bounded: a single bulk request may not carry an unbounded task list.
    tasks: list[dict[str, Any]] = Field(max_length=500)

class TaskMove(BaseModel):
    board_id: int

class BulkUpdateResponse(BaseModel):
    updated: int
    created: int
    errors: list[dict[str, Any]] = []

class WebhookBase(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    url: str = Field(max_length=2048)
    token: str | None = Field(default=None, max_length=256)  # HMAC secret
    chat_id: str = Field(max_length=100)
    thread_id: str | None = Field(default=None, max_length=50)
    events: builtins.list[str] = []
    excluded_events: builtins.list[str] = []

    @field_validator("name")
    @classmethod
    def _name_not_empty(cls, v: str | None) -> str | None:
        # None is allowed for the board-scoped upsert (WebhookPut defaults it
        # to the board name); only explicit empty strings are rejected.
        if v is not None and not v.strip():
            raise ValueError("Укажите название веб-хука")
        return v

    @field_validator("url")
    @classmethod
    def _url_check(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Укажите URL приёмника уведомлений")
        if " " in v:
            raise ValueError("URL не должен содержать пробелов")
        # SSRF guard: http(s) only, public hosts only (see security.py).
        return validate_webhook_url(v)

    @field_validator("chat_id")
    @classmethod
    def _chat_id_check(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("Укажите Telegram Chat ID (например: -1001234567890)")
        return v.strip()

    @field_validator("thread_id")
    @classmethod
    def _thread_id_check(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            return None
        return v

    @field_validator("events", "excluded_events")
    @classmethod
    def _events_not_empty(cls, v: builtins.list[str]) -> builtins.list[str]:
        # allow empty list (validation of known events happens in the router)
        return v or []

class WebhookCreate(WebhookBase):
    user_id: int  # webhook is bound to a specific user (owner of its tasks)
    board_id: int  # ...and to a specific board (only its task events fire)

class WebhookPut(BaseModel):
    """Payload for the board-scoped upsert (PUT /boards/{id}/webhook):
    user and board are taken from the caller and the path, one webhook
    per board. All fields are optional: on update only the provided ones
    are replaced; on creation url and chat_id are required."""

    name: str | None = Field(default=None, max_length=100)
    url: str | None = Field(default=None, max_length=2048)
    token: str | None = Field(default=None, max_length=256)  # HMAC secret
    chat_id: str | None = Field(default=None, max_length=100)
    thread_id: str | None = Field(default=None, max_length=50)
    events: builtins.list[str] | None = None
    excluded_events: builtins.list[str] | None = None

    @field_validator("url")
    @classmethod
    def _url_check(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("Укажите URL приёмника уведомлений")
        if " " in v:
            raise ValueError("URL не должен содержать пробелов")
        # SSRF guard: http(s) only, public hosts only (see security.py).
        return validate_webhook_url(v)

    @field_validator("chat_id")
    @classmethod
    def _chat_id_check(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = (v or "").strip()
        if not v:
            raise ValueError("Укажите Telegram Chat ID (например: -1001234567890)")
        return v

    @field_validator("thread_id")
    @classmethod
    def _thread_id_check(cls, v: str | None) -> str | None:
        return v.strip() if v and v.strip() else None


class WebhookUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    token: str | None = None
    chat_id: str | None = None
    thread_id: str | None = None
    board_id: int | None = None
    events: builtins.list[str] | None = None
    excluded_events: builtins.list[str] | None = None

class WebhookResponse(BaseModel):
    id: int
    user_id: int
    board_id: int | None = None
    name: str
    url: str
    token: str | None = None
    chat_id: str
    thread_id: str | None = None
    events: builtins.list[str] = []
    excluded_events: builtins.list[str] = []
    created_at: datetime
    board_name: str | None = None  # filled for the admin overview table

    model_config = {"from_attributes": True}
