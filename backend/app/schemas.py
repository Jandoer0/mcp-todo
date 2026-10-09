from pydantic import BaseModel, Field, computed_field, field_validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    # Stored hashed token is never serialized; only expose whether one is set.
    mcp_token_hash: Optional[str] = Field(default=None, exclude=True)

    model_config = {"from_attributes": True, "extra": "ignore"}

    @computed_field
    @property
    def has_mcp_token(self) -> bool:
        return bool(self.mcp_token_hash)

class UserCreate(BaseModel):
    username: str
    password: str
    role: Optional[str] = "user"

class Token(BaseModel):
    access_token: str
    token_type: str

class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    list: Optional[str] = "Входящие"
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    priority: Optional[int] = 1
    tags: Optional[List[str]] = []
    # Cyclic task settings
    is_cyclic: Optional[bool] = False
    cycle_period: Optional[str] = None  # daily | weekly | monthly | yearly
    cycle_interval: Optional[int] = 1
    reminder_days: Optional[int] = 0

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    list: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    priority: Optional[int] = None
    tags: Optional[List[str]] = None
    blocked_by: Optional[List[int]] = None

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

    model_config = {"from_attributes": True}

class TaskListCreate(BaseModel):
    name: str
    color: Optional[str] = None
    position: Optional[int] = None

class TaskListUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    position: Optional[int] = None

class TagCreate(BaseModel):
    name: str
    color: str

class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None

class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    list: str
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    priority: int
    tags: List[str] = []
    created_at: datetime
    blocked_by: List[int] = []
    is_blocked: bool = False
    # Cyclic task info
    is_cyclic: bool = False
    cycle_period: Optional[str] = None
    cycle_interval: Optional[int] = 1
    cycle_group_id: Optional[str] = None
    reminder_days: Optional[int] = 0
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
    deadline: Optional[datetime] = None
    logged_at: datetime

    model_config = {"from_attributes": True}

class TaskBulkUpdate(BaseModel):
    tasks: List[Dict[str, Any]]

class BulkUpdateResponse(BaseModel):
    updated: int
    created: int
    errors: List[Dict[str, Any]] = []
