import sqlite3
from datetime import datetime, timezone

from .config import SQLITE_PATH


def connect():
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
            """
        )


def add_chat_message(role: str, content: str):
    with connect() as conn:
        conn.execute(
            "INSERT INTO chat_messages (role, content, created_at) VALUES (?, ?, ?)",
            (role, content, datetime.now(timezone.utc).isoformat()),
        )


def get_chat_history(limit: int = 20):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT role, content FROM chat_messages
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


def add_memory(content: str):
    clean = content.strip()
    if not clean:
        return
    with connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO memories (content, created_at) VALUES (?, ?)",
            (clean, datetime.now(timezone.utc).isoformat()),
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
