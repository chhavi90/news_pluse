"""A tiny database adapter so the same SQL runs on SQLite (local) and Postgres (hosted).

SQL is written with ``?`` placeholders; the adapter rewrites them for psycopg2.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator, Sequence

from .config import ROOT, Settings

ISO_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def to_iso(dt: datetime) -> str:
    """Datetime -> canonical UTC ISO string used everywhere in the DB."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime(ISO_FORMAT)


def from_db(value: Any) -> datetime:
    """Read a timestamp back from either SQLite (str) or Postgres (datetime)."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class Database:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.dialect = "postgres" if settings.database_url else "sqlite"
        self._conn = None
        self._in_tx = False

    # ---- connection ---------------------------------------------------
    def connect(self) -> "Database":
        if self._conn is not None:
            return self
        if self.dialect == "postgres":
            import psycopg2  # imported lazily so SQLite-only setups don't need it

            self._conn = psycopg2.connect(self.settings.database_url)
        else:
            path = self.settings.sqlite_path
            path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(path), timeout=30)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA busy_timeout=30000")
        return self

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def __enter__(self) -> "Database":
        return self.connect()

    def __exit__(self, *exc) -> None:
        self.close()

    # ---- helpers -------------------------------------------------------
    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.dialect == "postgres" else sql

    def _cursor(self):
        if self.dialect == "postgres":
            from psycopg2.extras import RealDictCursor

            return self._conn.cursor(cursor_factory=RealDictCursor)
        return self._conn.cursor()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Group several statements into one atomic unit."""
        self._in_tx = True
        try:
            yield
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        finally:
            self._in_tx = False

    # ---- API ---------------------------------------------------------------
    def init_schema(self) -> None:
        schema = (ROOT / "db" / f"schema.{self.dialect}.sql").read_text(encoding="utf-8")
        if self.dialect == "sqlite":
            self._conn.executescript(schema)
        else:
            cur = self._conn.cursor()
            cur.execute(schema)
            cur.close()
        self._conn.commit()

    def query(self, sql: str, params: Sequence[Any] = ()) -> list[dict]:
        cur = self._cursor()
        cur.execute(self._sql(sql), tuple(params))
        rows = [dict(r) for r in cur.fetchall()]
        cur.close()
        if not self._in_tx:
            self._conn.commit()
        return rows

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        cur = self._cursor()
        cur.execute(self._sql(sql), tuple(params))
        count = cur.rowcount
        cur.close()
        if not self._in_tx:
            self._conn.commit()
        return count

    def executemany(self, sql: str, seq: Iterable[Sequence[Any]]) -> None:
        rows = [tuple(r) for r in seq]
        if not rows:
            return
        cur = self._cursor()
        if self.dialect == "postgres":
            from psycopg2.extras import execute_batch

            execute_batch(cur, self._sql(sql), rows, page_size=200)
        else:
            cur.executemany(sql, rows)
        cur.close()
        if not self._in_tx:
            self._conn.commit()
