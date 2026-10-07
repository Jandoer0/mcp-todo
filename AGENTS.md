# AGENTS.md — OmniTask MCP

Guidance for AI agents editing this project.

## What it is
A task-management web app + MCP server in one container:
- **Backend**: FastAPI + SQLAlchemy (SQLite), JWT auth, served at `/api`.
- **Frontend**: React + Vite + Tailwind, built to `dist/` and served as static files.
- **MCP**: FastMCP exposed over SSE at `/sse` and `/messages`.

## Layout (one responsibility per file)
```
backend/
  app/
    main.py            # app factory: mounts /api, MCP routes, static files
    config.py          # env settings (SECRET_KEY, DATABASE_URL, BUILD_VERSION)
    db.py              # engine / SessionLocal / get_db dependency
    models.py          # SQLAlchemy models (User, Task)
    schemas.py         # Pydantic request/response models
    auth.py            # password hashing, JWT, get_current_user / get_current_admin
    routers/
      auth.py          # /auth/register, /auth/login
      tasks.py         # /tasks CRUD (user-scoped)
      summary.py       # /summary statistics
      admin.py         # /admin/users (admin-only)
      mcp.py           # MCP SSE server + tools
frontend/
  src/
    api/client.js      # axios instance + per-domain API functions
    hooks/             # useAuth, useTasks, useTheme (state + data logic)
    components/         # Login, Layout, Dashboard, TaskList, TaskForm, AdminPanel
    App.jsx            # thin root: wires hooks + components
```

## How to add a feature
- **New API endpoint**: add a function in the relevant `routers/*.py`, register with
  `@router.get/post/...`. Add/extend the schema in `schemas.py`.
- **New frontend screen/part**: add a component in `components/`, expose data via a
  `hooks/` hook, and wire it in `App.jsx`. Call the API through `api/client.js`.
- **New MCP tool**: add an `@mcp.tool()` function in `routers/mcp.py`. Always take
  `auth_token` as the first arg and resolve the user with `get_user_from_token`.

## Conventions
- Auth: JWT in `Authorization: Bearer <token>`. The axios interceptor in
  `api/client.js` attaches it automatically — do not set it manually.
- All task queries are scoped to `current_user.id`.
- The frontend build bakes `BUILD_VERSION` (git SHA) and self-reloads when the
  backend version differs. Don't remove the version check in `useAuth.js`.

## Local dev
```bash
./scripts/dev.sh          # backend :8000, frontend :5173 (with proxy)
```
Built image: `ghcr.io/jandoer0/mcp-todo:latest`, run via the `mcp-todo` quadlet.
