"""Database engine, session factory and declarative base."""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

connect_args = {"check_same_thread": False} if settings["DATABASE_URL"].startswith("sqlite") else {}

engine = create_engine(settings["DATABASE_URL"], connect_args=connect_args)

if settings["DATABASE_URL"].startswith("sqlite"):
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        # WAL avoids "database is locked" under concurrent MCP/API writes;
        # busy_timeout lets writers wait briefly instead of failing fast.
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
