"""Pydantic request/response schemas."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user"


class UserResponse(BaseModel):
    id: int
    username: str
    role: str

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    priority: int = 1
    tags: Optional[List[str]] = None
    list: str = "Входящие"
    blocked_by: Optional[List[int]] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    tags: Optional[List[str]] = None
    list: Optional[str] = None
    blocked_by: Optional[List[int]] = None


class TagResponse(BaseModel):
    id: int
    name: str
    color: str

    model_config = {"from_attributes": True}


class TaskResponse(BaseModel):
    id: int
    user_id: int
    title: str
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    priority: int
    status: str
    tags: List[TagResponse] = []
    list: Optional[str] = "Входящие"
    blocked_by: List[int] = []
    is_blocked: bool = False
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TaskListResponse(BaseModel):
    id: int
    name: str
    color: str
    position: int
    is_default: bool
    kind: Optional[str] = None

    model_config = {"from_attributes": True}


class TaskListCreate(BaseModel):
    name: str
    color: str
    position: Optional[int] = 0


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


class SummaryResponse(BaseModel):
    total: int
    todo: int
    in_progress: int
    done: int
    overdue: int


class SettingsResponse(BaseModel):
    allow_registration: bool
