# OmniTask MCP

Task management web app with an integrated MCP server.

- **Backend**: FastAPI + SQLAlchemy (SQLite), JWT auth — `/api`
- **Frontend**: React + Vite + Tailwind — served as static files
- **MCP**: FastMCP over SSE — `/sse`, `/messages`

## Features
- Register / login, role-based access (user / admin)
- Task CRUD with status, priority, deadline, tags
- Dashboard statistics (total / todo / in_progress / overdue)
- Light / dark / system theming
- Admin panel for managing users
- MCP tools scoped per-user by JWT: `list_tasks`, `create_task`,
  `update_task`, `delete_task`, `search_tasks`, `get_project_summary`

## Local development
```bash
./scripts/dev.sh
```
Backend runs on `:8000`, frontend dev server on `:5173` (proxies API calls).

## Deployment
Built to `ghcr.io/jandoer0/mcp-todo:latest` via GitHub Actions and run as a
Podman quadlet (`infra/mcp-todo.container`), proxied by Caddy at `todo.local`.

The frontend self-reloads when a new backend version is deployed, so no manual
cache clearing is required after an update.
