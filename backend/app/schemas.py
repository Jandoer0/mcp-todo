import builtins
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, computed_field, field_validator


class BoardResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    color: str
    position: int

    model_config = {"from_attributes": True}

class BoardCreate(BaseModel):
    name: str
    description: str | None = None
    color: str = "#0ea5e9"

class BoardUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    position: int | None = None

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    # Stored hashed token is never serialized; only expose whether one is set.
    mcp_token_hash: str | None = Field(default=None, exclude=True)

    model_config = {"from_attributes": True, "extra": "ignore"}

    @computed_field
    @property
    def has_mcp_token(self) -> bool:
        return bool(self.mcp_token_hash)

class UserCreate(BaseModel):
    username: str
    password: str
    role: str | None = "user"

class Token(BaseModel):
    access_token: str
    token_type: str

class TaskBase(BaseModel):
    title: str
    description: str | None = None
    list: str | None = "Входящие"
    start_date: datetime | None = None
    deadline: datetime | None = None
    priority: int | None = 1
    tags: builtins.list[str] | None = []
    # Owning board (required for creation; verified server-side)
    board_id: int | None = None
    # Blocking tasks (ids of tasks that must be done before this one)
    blocked_by: builtins.list[int] | None = None
    # Cyclic task settings
    is_cyclic: bool | None = False
    cycle_period: str | None = None  # daily | weekly | monthly | yearly
    cycle_interval: int | None = 1
    reminder_days: int | None = 0
    # Financial weight: positive = income, negative = expense (0 = no budget)
    amount: float | None = 0.0

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
    name: str
    color: str | None = None
    position: int | None = None
    # 'todo' | 'progress' | 'done' | None (regular list)
    kind: str | None = None

class TaskListUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    position: int | None = None
    kind: str | None = None

class TagCreate(BaseModel):
    name: str
    color: str

class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None

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
    tasks: list[dict[str, Any]]

class TaskMove(BaseModel):
    board_id: int

class BulkUpdateResponse(BaseModel):
    updated: int
    created: int
    errors: list[dict[str, Any]] = []

class WebhookBase(BaseModel):
    name: str
    url: str
    token: str | None = None
    chat_id: str
    thread_id: str | None = None
    events: builtins.list[str] = []
    excluded_events: builtins.list[str] = []

    @field_validator("name")
    @classmethod
    def _name_not_empty(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("Укажите название веб-хука")
        return v.strip()

    @field_validator("url")
    @classmethod
    def _url_check(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Укажите URL приёмника уведомлений")
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("URL должен начинаться с http:// или https://")
        if " " in v:
            raise ValueError("URL не должен содержать пробелов")
        return v

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

    model_config = {"from_attributes": True}
