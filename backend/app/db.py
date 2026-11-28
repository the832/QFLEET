"""Database engine: Neon (serverless Postgres) when DATABASE_URL is set, local SQLite otherwise.

Put the Neon connection string in backend/.env:
    DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _load_dotenv(path: Path) -> None:
    """Minimal .env reader (KEY=VALUE lines) so no extra dependency is needed."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv(BACKEND_DIR / ".env")

_raw = os.environ.get("DATABASE_URL", "").strip()
if _raw.startswith("sqlite"):  # tests and offline runs
    DB_KIND, DB_HOST = "sqlite", _raw
    engine = create_engine(_raw, connect_args={"check_same_thread": False})
elif _raw:
    # Neon hands out postgres:// or postgresql:// URLs; use the psycopg 3 driver.
    url = _raw.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    host = urlsplit(_raw).hostname or ""
    DB_KIND = "neon" if "neon.tech" in host else "postgres"
    DB_HOST = host
    # Neon suspends idle computes: pre-ping and recycle so stale connections are replaced.
    engine = create_engine(url, pool_pre_ping=True, pool_recycle=1800, pool_size=8, max_overflow=8)
else:
    path = BACKEND_DIR / "qfleet_inventory.db"
    DB_KIND = "sqlite"
    DB_HOST = path.name
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def keep_warm(interval_s: float = 120.0) -> None:
    """Neon's free tier suspends an idle database (first query then takes seconds) and new TLS
    connections cost ~1.5 s from India. A light ping every 2 minutes keeps both warm during a demo."""
    if DB_KIND == "sqlite":
        return
    import threading
    import time

    from sqlalchemy import text

    def warm_pool(n: int = 6):
        # open n connections at once and hand them back, so parallel requests find them ready
        conns = []
        try:
            for _ in range(n):
                conns.append(engine.connect())
            for c in conns:
                c.execute(text("select 1"))
        except Exception:  # noqa: BLE001
            pass
        finally:
            for c in conns:
                c.close()

    def loop():
        warm_pool()
        while True:
            try:
                with engine.connect() as c:
                    c.execute(text("select 1"))
            except Exception:  # noqa: BLE001 - best effort
                pass
            time.sleep(interval_s)

    threading.Thread(target=loop, daemon=True, name="db-keep-warm").start()


class Base(DeclarativeBase):
    pass
