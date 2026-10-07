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
    tag: Optional[str] = None
    list: str = "Входящие"
    blocked_by: Optional[List[int]] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    tag: Optional[str] = None
    list: Optional[str] = None
    blocked_by: Optional[List[int]] = None


class TaskResponse(BaseModel):
    id: int
    user_id: int
    title: str
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    priority: int
    status: str
    tag: Optional[str] = None
    list: Optional[str] = "Входящие"
    blocked_by: List[int] = []
    is_blocked: bool = False
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SummaryResponse(BaseModel):
    total: int
    todo: int
    in_progress: int
    done: int
    overdue: int


class SettingsResponse(BaseModel):
    allow_registration: bool
