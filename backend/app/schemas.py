import builtins
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, computed_field, field_validator


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
    # Blocking tasks (ids of tasks that must be done before this one)
    blocked_by: builtins.list[int] | None = None
    # Cyclic task settings
    is_cyclic: bool | None = False
    cycle_period: str | None = None  # daily | weekly | monthly | yearly
    cycle_interval: int | None = 1
    reminder_days: int | None = 0

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

class CycleLogResponse(BaseModel):
    id: int
    task_title: str
    action: str
    deadline: datetime | None = None
    logged_at: datetime

    model_config = {"from_attributes": True}

class TaskBulkUpdate(BaseModel):
    tasks: list[dict[str, Any]]

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

class WebhookCreate(WebhookBase):
    user_id: int  # webhook is bound to a specific user (owner of its tasks)

class WebhookUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    token: str | None = None
    chat_id: str | None = None
    thread_id: str | None = None
    events: builtins.list[str] | None = None
    excluded_events: builtins.list[str] | None = None

class WebhookResponse(BaseModel):
    id: int
    user_id: int
    name: str
    url: str
    token: str | None = None
    chat_id: str
    thread_id: str | None = None
    events: builtins.list[str] = []
    excluded_events: builtins.list[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}
