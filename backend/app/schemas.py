from pydantic import BaseModel, Field, computed_field
from typing import List, Optional, Dict, Any
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
    due_date: Optional[datetime] = None
    priority: Optional[int] = 1
    tags: Optional[List[str]] = []

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    list: Optional[str] = None
    due_date: Optional[datetime] = None
    priority: Optional[int] = None
    tags: Optional[List[str]] = None

class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    list: str
    due_date: Optional[datetime] = None
    priority: int
    tags: List[str] = []
    created_at: datetime

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

class TagResponse(BaseModel):
    id: int
    name: str
    color: str

    model_config = {"from_attributes": True}

class SummaryResponse(BaseModel):
    total: int
    todo: int
    in_progress: int
    done: int
    overdue: int

class SettingsResponse(BaseModel):
    allow_registration: bool

class TaskBulkUpdate(BaseModel):
    tasks: List[Dict[str, Any]]

class BulkUpdateResponse(BaseModel):
    updated: int
    created: int
    errors: List[Dict[str, Any]] = []
