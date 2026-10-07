from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse, HTMLResponse
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey, Text, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime, timedelta
from typing import List, Optional
import os
import json
from mcp.server.fastmcp import FastMCP
from mcp.server.sse import SseServerTransport
from starlette.applications import Starlette
from starlette.routing import Mount, Route
from sse_starlette.sse import EventSourceResponse
from starlette.requests import Request
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

def get_current_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Admin privileges required"
        )
    return current_user

# FastAPI App
app = FastAPI(title="OmniTask MCP API")

# Serve static files (Frontend build)
static_dir = "/app/static"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    return {"message": "OmniTask API is running. Frontend not found."}

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

# --- Admin Endpoints ---

@app.get("/admin/users", response_model=List[UserResponse])
def list_users(db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return db.query(User).all()

@app.put("/admin/users/{user_id}")
def update_user_role(user_id: int, role: str, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    if role not in ["admin", "user"]:
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'admin' or 'user'")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.role = role
    db.commit()
    return {"ok": True, "message": f"User {user.username} role updated to {role}"}

@app.delete("/admin/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db.delete(user)
    db.commit()
    return {"ok": True, "message": f"User deleted"}

@app.get("/summary")
def get_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(Task).filter(Task.user_id == current_user.id).count()
    todo = db.query(Task).filter(Task.user_id == current_user.id, Task.status == "todo").count()
    in_progress = db.query(Task).filter(Task.user_id == current_user.id, Task.status == "in_progress").count()
    done = db.query(Task).filter(Task.user_id == current_user.id, Task.status == "done").count()
    overdue = db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.deadline < datetime.utcnow(),
        Task.status != "done"
    ).count()
    
    return {
        "total": total,
        "todo": todo,
        "in_progress": in_progress,
        "done": done,
        "overdue": overdue
    }

# --- MCP Server ---

mcp_app = FastMCP("OmniTask")

def get_user_from_token(token: str) -> Optional[User]:
    """Helper to get user from JWT token for MCP tools"""
    payload = decode_access_token(token)
    if payload is None:
        return None
    username: str = payload.get("sub")
    if username is None:
        return None
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        return user
    finally:
        db.close()

@mcp_app.tool()
def list_tasks(auth_token: str, status: Optional[str] = None, priority: Optional[int] = None) -> str:
    """Get list of tasks for the authenticated user. auth_token is required."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
        
    db = SessionLocal()
    try:
        query = db.query(Task).filter(Task.user_id == user.id)
        if status:
            query = query.filter(Task.status == status)
        if priority:
            query = query.filter(Task.priority == priority)
            
        tasks = query.all()
        return json.dumps([{"id": t.id, "title": t.title, "status": t.status, "priority": t.priority, "deadline": str(t.deadline) if t.deadline else None} for t in tasks])
    finally:
        db.close()

@mcp_app.tool()
def create_task(auth_token: str, title: str, description: Optional[str] = None, deadline: Optional[str] = None, priority: int = 1, tag: Optional[str] = None) -> str:
    """Create a new task for the authenticated user. auth_token is required."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
        
    db = SessionLocal()
    try:
        new_task = Task(
            user_id=user.id,
            title=title,
            description=description,
            deadline=datetime.fromisoformat(deadline) if deadline else None,
            priority=priority,
            tag=tag
        )
        db.add(new_task)
        db.commit()
        return f"Task created with ID {new_task.id}"
    finally:
        db.close()

@mcp_app.tool()
def update_task(auth_token: str, task_id: int, title: Optional[str] = None, status: Optional[str] = None, priority: Optional[int] = None, tag: Optional[str] = None) -> str:
    """Update an existing task for the authenticated user. auth_token is required."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
        
    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == task_id, Task.user_id == user.id).first()
        if not task:
            return "Task not found"
            
        if title is not None: task.title = title
        if status is not None: task.status = status
        if priority is not None: task.priority = priority
        if tag is not None: task.tag = tag
        
        db.commit()
        return f"Task {task.id} updated"
    finally:
        db.close()

@mcp_app.tool()
def delete_task(auth_token: str, task_id: int) -> str:
    """Delete a task for the authenticated user. auth_token is required."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
        
    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == task_id, Task.user_id == user.id).first()
        if not task:
            return "Task not found"
            
        db.delete(task)
        db.commit()
        return f"Task {task.id} deleted"
    finally:
        db.close()

@mcp_app.tool()
def search_tasks(auth_token: str, query_str: str) -> str:
    """Search tasks by title or description for the authenticated user. auth_token is required."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
        
    db = SessionLocal()
    try:
        tasks = db.query(Task).filter(
            Task.user_id == user.id,
            (Task.title.ilike(f"%{query_str}%") | Task.description.ilike(f"%{query_str}%"))
        ).all()
        return json.dumps([{"id": t.id, "title": t.title, "status": t.status} for t in tasks])
    finally:
        db.close()

@mcp_app.tool()
def get_project_summary(auth_token: str) -> str:
    """Get summary of tasks for the authenticated user. auth_token is required."""
    user = get_user_from_token(auth_token)
    if not user:
        return "Error: Invalid or missing authentication token"
        
    db = SessionLocal()
    try:
        total = db.query(Task).filter(Task.user_id == user.id).count()
        todo = db.query(Task).filter(Task.user_id == user.id, Task.status == "todo").count()
        in_progress = db.query(Task).filter(Task.user_id == user.id, Task.status == "in_progress").count()
        done = db.query(Task).filter(Task.user_id == user.id, Task.status == "done").count()
        overdue = db.query(Task).filter(
            Task.user_id == user.id,
            Task.deadline < datetime.utcnow(),
            Task.status != "done"
        ).count()
        
        summary = {
            "total": total,
            "todo": todo,
            "in_progress": in_progress,
            "done": done,
            "overdue": overdue
        }
        return json.dumps(summary)
    finally:
        db.close()

# Mount MCP SSE
sse = SseServerTransport("/messages/")

async def handle_sse(request: Request):
    async with sse.connect_sse(request.scope, request.receive, request._send) as streams:
        await mcp_app.run(streams[0], streams[1], mcp_app.create_initialization_options())

async def handle_messages(request: Request):
    await sse.handle_post_message(request.scope, request.receive, request._send)

async def serve_frontend(request):
    # Serve static files from /app/static
    path = request.path_params.get("path", "index.html")
    full_path = os.path.join(static_dir, path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return FileResponse(full_path)
    # Fallback to index.html for SPA routing
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    return HTMLResponse("<h1>OmniTask API</h1><p>Frontend not found.</p>")

# Combine FastAPI and MCP
starlette_app = Starlette(
    routes=[
        Mount("/api", app=app),
        Route("/sse", endpoint=handle_sse),
        Route("/messages", endpoint=handle_messages, methods=["POST"]),
        Mount("/", app=StaticFiles(directory=static_dir, html=True)),
    ]
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(starlette_app, host="0.0.0.0", port=8000)
