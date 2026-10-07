"""Application entrypoint.

Builds a FastAPI app (the JSON API mounted at /api), adds the MCP SSE routes
and serves the built frontend as static files. The Starlette app exposed as
``starlette_app`` is what the container runs.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.applications import Starlette
from starlette.responses import FileResponse, HTMLResponse
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

from . import models  # noqa: F401  (ensures models are registered)
from .config import settings
from .db import Base, engine
from .routers import admin, auth, mcp, summary, tasks

Base.metadata.create_all(bind=engine)

# --- JSON API (mounted at /api) ---
api = FastAPI(title="OmniTask API")
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
api.include_router(auth.router)
api.include_router(tasks.router)
api.include_router(summary.router)
api.include_router(admin.router)


@api.get("/health")
def health():
    return {"status": "ok", "version": settings["BUILD_VERSION"]}


# --- Static frontend serving ---
static_dir = os.getenv("STATIC_DIR", "/app/static")


class NoCacheStaticFiles(StaticFiles):
    """Disable caching for HTML so new frontend builds are always picked up."""

    async def get_response(self, *args, **kwargs):
        resp = await super().get_response(*args, **kwargs)
        if "text/html" in (resp.media_type or ""):
            resp.headers["Cache-Control"] = "no-store"
        return resp


async def serve_frontend(request):
    path = request.path_params.get("path", "index.html")
    full = os.path.join(static_dir, path)
    if os.path.exists(full) and os.path.isfile(full):
        return FileResponse(full)
    index = os.path.join(static_dir, "index.html")
    if os.path.exists(index):
        return FileResponse(index, media_type="text/html")
    return HTMLResponse("<h1>OmniTask</h1><p>Frontend not built.</p>")


starlette_app = Starlette(
    routes=[
        Mount("/api", app=api),
        *mcp.mcp_routes,
        Mount("/", app=NoCacheStaticFiles(directory=static_dir, html=True)),
    ]
)
