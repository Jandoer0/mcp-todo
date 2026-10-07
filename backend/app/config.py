"""Application configuration loaded from environment variables."""
import os
from functools import lru_cache


@lru_cache
def get_settings():
    return {
        "SECRET_KEY": os.getenv("SECRET_KEY", "change-me-in-production"),
        "ALGORITHM": "HS256",
        "ACCESS_TOKEN_EXPIRE_MINUTES": 60 * 24,
        "DATABASE_URL": os.getenv("DATABASE_URL", "sqlite:///./data/tasks.db"),
        "BUILD_VERSION": os.getenv("BUILD_VERSION", "dev"),
    }


settings = get_settings()
