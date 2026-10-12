"""Application configuration loaded from environment variables."""
import os
from functools import lru_cache


@lru_cache
def get_settings():
    # Fail fast: without an explicit SECRET_KEY every JWT could be forged by
    # anyone who knows the (well-known) default — refuse to start instead.
    secret_key = os.getenv("SECRET_KEY")
    if not secret_key:
        raise RuntimeError(
            "SECRET_KEY env var is required. Generate one with: "
            "python3 -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    return {
        "SECRET_KEY": secret_key,
        "ALGORITHM": "HS256",
        "ACCESS_TOKEN_EXPIRE_MINUTES": int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480")),
        # Comma-separated list of allowed CORS origins. Empty => CORS disabled.
        "CORS_ORIGINS": [
            o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()
        ],
        "DATABASE_URL": os.getenv("DATABASE_URL", "sqlite:///./data/tasks.db"),
        "BUILD_VERSION": os.getenv("BUILD_VERSION", "dev"),
    }


settings = get_settings()
