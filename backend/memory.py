import sqlite3
from datetime import datetime, timedelta, timezone

from .config import SQLITE_PATH


SESSION_IDLE_HOURS = 8


def connect():
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                summary TEXT NOT NULL DEFAULT '',
                summary_message_count INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        _ensure_column(conn, "chat_messages", "session_id", "INTEGER")
        _ensure_column(conn, "chat_sessions", "summary", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(conn, "chat_sessions", "summary_message_count", "INTEGER NOT NULL DEFAULT 0")
        _backfill_legacy_session(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
            """
        )


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _ensure_column(conn, table: str, column: str, definition: str):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    if any(row["name"] == column for row in rows):
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _create_session(conn, *, title: str | None = None):
    now = _now_iso()
    cur = conn.execute(
        """
        INSERT INTO chat_sessions (title, summary, summary_message_count, started_at, updated_at)
        VALUES (?, '', 0, ?, ?)
        """,
        (title or "Conversacion", now, now),
    )
    return cur.lastrowid


def _backfill_legacy_session(conn):
    null_count = conn.execute(
        "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id IS NULL"
    ).fetchone()["count"]
    if not null_count:
        return
    first_row = conn.execute(
        "SELECT created_at FROM chat_messages WHERE session_id IS NULL ORDER BY id ASC LIMIT 1"
    ).fetchone()
    last_row = conn.execute(
        "SELECT created_at FROM chat_messages WHERE session_id IS NULL ORDER BY id DESC LIMIT 1"
    ).fetchone()
    started_at = first_row["created_at"] if first_row else _now_iso()
    updated_at = last_row["created_at"] if last_row else started_at
    cur = conn.execute(
        """
        INSERT INTO chat_sessions (title, summary, summary_message_count, started_at, updated_at)
        VALUES (?, '', 0, ?, ?)
        """,
        ("Historial importado", started_at, updated_at),
    )
    conn.execute("UPDATE chat_messages SET session_id = ? WHERE session_id IS NULL", (cur.lastrowid,))


def get_or_create_current_session():
    with connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM chat_sessions
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
        now = datetime.now(timezone.utc)
        if row:
            updated_at = _parse_iso(row["updated_at"])
            same_day = updated_at and updated_at.date() == now.date()
            still_active = updated_at and now - updated_at <= timedelta(hours=SESSION_IDLE_HOURS)
            if same_day and still_active:
                return dict(row)
        session_id = _create_session(conn)
        return dict(conn.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)).fetchone())


def get_session(session_id: int):
    with connect() as conn:
        row = conn.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
    return dict(row) if row else None


def list_sessions(limit: int = 30):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, title, summary, started_at, updated_at
            FROM chat_sessions
            ORDER BY updated_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_new_session(title: str | None = None):
    with connect() as conn:
        session_id = _create_session(conn, title=title)
        return dict(conn.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)).fetchone())


def add_chat_message(role: str, content: str, session_id: int | None = None):
    if session_id is None:
        session_id = get_or_create_current_session()["id"]
    now = _now_iso()
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (session_id, role, content, now),
        )
        conn.execute("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", (now, session_id))
        return cur.lastrowid


def get_chat_history(limit: int = 20, session_id: int | None = None):
    if session_id is None:
        session_id = get_or_create_current_session()["id"]
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT role, content, created_at FROM chat_messages
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


def count_session_messages(session_id: int):
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?",
            (session_id,),
        ).fetchone()
    return int(row["count"] if row else 0)


def get_session_messages_for_summary(session_id: int, limit: int = 80):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT role, content FROM chat_messages
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


def update_session_summary(session_id: int, summary: str, message_count: int):
    with connect() as conn:
        conn.execute(
            """
            UPDATE chat_sessions
            SET summary = ?, summary_message_count = ?, updated_at = ?
            WHERE id = ?
            """,
            (summary.strip(), int(message_count), _now_iso(), session_id),
        )


def add_memory(content: str):
    clean = content.strip()
    if not clean:
        return
    with connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO memories (content, created_at) VALUES (?, ?)",
            (clean, _now_iso()),
        )


def get_memories(limit: int = 20):
    with connect() as conn:
        rows = conn.execute(
            "SELECT content FROM memories ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [row["content"] for row in rows]


def clear_chat():
    with connect() as conn:
        conn.execute("DELETE FROM chat_messages")
        conn.execute("DELETE FROM chat_sessions")
