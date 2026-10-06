from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey, Text, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime, timedelta
from typing import List, Optional
import os
import json
from mcp.server import Server
from mcp.server.sse import SseServerTransport
from starlette.applications import Starlette
from starlette.routing import Mount, Route
from sse_starlette.sse import EventSourceResponse
import asyncio

# Database setup
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tasks.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Models
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String, default="user") # admin, user

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String)
    description = Column(Text, nullable=True)
    deadline = Column(DateTime, nullable=True)
    priority = Column(Integer, default=1) # 1: Low, 2: Medium, 3: High
    status = Column(String, default="todo") # todo, in_progress, done
    tag = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

# Auth helpers
from backend.auth import verify_password, get_password_hash, create_access_token, decode_access_token

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token = auth_header.split(" ")[1]
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    username: str = payload.get("sub")
    if username is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

# FastAPI App
app = FastAPI(title="OmniTask MCP API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API Endpoints ---

from backend.schemas import TaskCreate, TaskUpdate, TaskResponse, UserCreate, UserResponse, Token

@app.post("/auth/register", response_model=UserResponse)
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password, role=user.role)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/auth/login", response_model=Token)
def login(username: str, password: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    access_token_expires = timedelta(minutes=60 * 24)
    access_token = create_access_token(data={"sub": user.username}, expires_delta=access_token_expires)
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/tasks", response_model=List[TaskResponse])
def list_tasks(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tasks = db.query(Task).filter(Task.user_id == current_user.id).all()
    return tasks

@app.post("/tasks", response_model=TaskResponse)
def create_task(task: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_task = Task(**task.dict(), user_id=current_user.id)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task

@app.put("/tasks/{task_id}", response_model=TaskResponse)
def update_task(task_id: int, task: TaskUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    update_data = task.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_task, key, value)
    db.commit()
    db.refresh(db_task)
    return db_task

@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(db_task)
    db.commit()
    return {"ok": True}

@app.get("/health")
def health_check():
    return {"status": "ok"}

# --- MCP Server ---

mcp_app = Server("OmniTask")

@mcp_app.list_tools()
async def list_tools():
    from mcp.types import Tool
    return [
        Tool(
            name="list_tasks",
            description="Get list of tasks for the current user",
            inputSchema={
                "type": "object",
                "properties": {
                    "status": {"type": "string", "description": "Filter by status (todo, in_progress, done)"},
                    "priority": {"type": "integer", "description": "Filter by priority (1-3)"}
                },
                "required": []
            }
        ),
        Tool(
            name="create_task",
            description="Create a new task",
            inputSchema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "deadline": {"type": "string", "description": "ISO format date"},
                    "priority": {"type": "integer", "default": 1},
                    "tag": {"type": "string"}
                },
                "required": ["title"]
            }
        ),
        Tool(
            name="update_task",
            description="Update an existing task",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer"},
                    "title": {"type": "string"},
                    "status": {"type": "string"},
                    "priority": {"type": "integer"},
                    "tag": {"type": "string"}
                },
                "required": ["task_id"]
            }
        ),
        Tool(
            name="delete_task",
            description="Delete a task",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer"}
                },
                "required": ["task_id"]
            }
        )
    ]

@mcp_app.call_tool()
async def call_tool(name: str, arguments: dict):
    # Note: MCP context doesn't easily pass JWT. 
    # For this implementation, we assume a default user or rely on env vars for demo.
    # In production, MCP transport should handle auth or use a service account.
    db = SessionLocal()
    try:
        # For now, let's pick the first user or create a default one if missing
        user = db.query(User).first()
        if not user:
            user = User(username="admin", hashed_password=get_password_hash("admin"), role="admin")
            db.add(user)
            db.commit()
            db.refresh(user)

        if name == "list_tasks":
            tasks = db.query(Task).filter(Task.user_id == user.id).all()
            return [{"content": [{"type": "text", "text": json.dumps([{"id": t.id, "title": t.title, "status": t.status} for t in tasks])}]}]
        
        elif name == "create_task":
            new_task = Task(
                user_id=user.id,
                title=arguments["title"],
                description=arguments.get("description"),
                deadline=datetime.fromisoformat(arguments["deadline"]) if arguments.get("deadline") else None,
                priority=arguments.get("priority", 1),
                tag=arguments.get("tag")
            )
            db.add(new_task)
            db.commit()
            return [{"content": [{"type": "text", "text": f"Task created with ID {new_task.id}"}]}]
        
        elif name == "update_task":
            task = db.query(Task).filter(Task.id == arguments["task_id"], Task.user_id == user.id).first()
            if not task:
                return [{"content": [{"type": "text", "text": "Task not found"}]}]
            if "title" in arguments: task.title = arguments["title"]
            if "status" in arguments: task.status = arguments["status"]
            if "priority" in arguments: task.priority = arguments["priority"]
            if "tag" in arguments: task.tag = arguments["tag"]
            db.commit()
            return [{"content": [{"type": "text", "text": f"Task {task.id} updated"}]}]
            
        elif name == "delete_task":
            task = db.query(Task).filter(Task.id == arguments["task_id"], Task.user_id == user.id).first()
            if not task:
                return [{"content": [{"type": "text", "text": "Task not found"}]}]
            db.delete(task)
            db.commit()
            return [{"content": [{"type": "text", "text": f"Task {task.id} deleted"}]}]
            
    finally:
        db.close()

# Mount MCP SSE
sse = SseServerTransport("/messages/")

async def handle_sse(request: Request):
    async with sse.connect_sse(request.scope, request.receive, request._send) as streams:
        await mcp_app.run(streams[0], streams[1], mcp_app.create_initialization_options())

async def handle_messages(request: Request):
    await sse.handle_post_message(request.scope, request.receive, request._send)

# Combine FastAPI and MCP
starlette_app = Starlette(
    routes=[
        Mount("/api", app=app),
        Route("/sse", endpoint=handle_sse),
        Route("/messages", endpoint=handle_messages, methods=["POST"]),
    ]
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(starlette_app, host="0.0.0.0", port=8000)
