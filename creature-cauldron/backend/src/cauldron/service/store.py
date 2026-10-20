"""The SQLite store: generated monsters, the daily usage counter, and remembered reskins.

SQLite is a database in one file, built into Python. Three rules keep it safe:

* every value goes into a query through a ``?`` placeholder, never pasted into the SQL text, so odd input cannot
  change what a query does ("SQL injection");
* every change happens inside a transaction (``with self._conn``), so a crash cannot leave half a change;
* one lock guards the single connection, because the web server runs requests on several threads.
"""

import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path

from cauldron.monster import Monster
from cauldron.service.matching import matches
from cauldron.service.models import GenerateRequest

_SCHEMA = """
CREATE TABLE IF NOT EXISTS monsters (
    id       TEXT PRIMARY KEY,
    name_key TEXT NOT NULL UNIQUE,
    json     TEXT NOT NULL,
    cr_value REAL NOT NULL,
    type     TEXT NOT NULL,
    size     TEXT NOT NULL,
    role     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS monsters_by_filter ON monsters (type, size, role, cr_value);
CREATE TABLE IF NOT EXISTS ai_usage (
    day           TEXT PRIMARY KEY,
    calls         INTEGER NOT NULL DEFAULT 0,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reskins (
    key        TEXT PRIMARY KEY,
    monster_id TEXT NOT NULL REFERENCES monsters (id)
);
"""


class DuplicateMonster(ValueError):
    """A monster with this id or this name is already stored."""


@dataclass(frozen=True)
class Usage:
    calls: int
    input_tokens: int
    output_tokens: int


def name_key(name: str) -> str:
    """Names are unique ignoring case and spacing."""
    return " ".join(name.lower().split())


class MonsterStore:
    def __init__(self, path: str | Path) -> None:
        in_memory = str(path) == ":memory:"
        if not in_memory:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False lets the web server's worker threads share the connection; the lock makes that safe.
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._lock = threading.RLock()
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA busy_timeout = 5000")
        if not in_memory:
            self._conn.execute("PRAGMA journal_mode = WAL")  # readers do not block the writer
        with self._lock, self._conn:
            self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # --- monsters ---------------------------------------------------------------------------------------

    def add(self, monster: Monster) -> None:
        try:
            with self._lock, self._conn:
                self._conn.execute(
                    "INSERT INTO monsters (id, name_key, json, cr_value, type, size, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        monster.id,
                        name_key(monster.name),
                        monster.model_dump_json(exclude_none=True),
                        monster.challenge.cr_value,
                        monster.type.value,
                        monster.size.value,
                        monster.role.value,
                    ),
                )
        except sqlite3.IntegrityError as error:
            raise DuplicateMonster(f'A monster with this id or the name "{monster.name}" is already stored.') from error

    def get(self, monster_id: str) -> Monster | None:
        with self._lock:
            row = self._conn.execute("SELECT json FROM monsters WHERE id = ?", (monster_id,)).fetchone()
        return Monster.model_validate_json(row[0]) if row else None

    def all(self) -> list[Monster]:
        with self._lock:
            rows = self._conn.execute("SELECT json FROM monsters ORDER BY rowid").fetchall()
        return [Monster.model_validate_json(row[0]) for row in rows]

    def count(self) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM monsters").fetchone()[0]

    def names(self) -> frozenset[str]:
        with self._lock:
            return frozenset(row[0] for row in self._conn.execute("SELECT name_key FROM monsters"))

    def find(self, request: GenerateRequest, exclude_ids: frozenset[str], limit: int | None = None) -> list[Monster]:
        """Stored monsters that fit the request and are not excluded, oldest first.

        The database narrows by challenge rating, type, size and role (the indexed columns); the exact rules,
        including environments, themes and features, are then applied by ``matches``.
        """
        clauses: list[str] = []
        values: list[object] = []
        if request.cr_min is not None:
            clauses.append("cr_value >= ?")
            values.append(request.cr_min)
        if request.cr_max is not None:
            clauses.append("cr_value <= ?")
            values.append(request.cr_max)
        for column, picks in (("type", request.types), ("size", request.sizes), ("role", request.roles)):
            if picks:
                clauses.append(f"{column} IN ({','.join('?' * len(picks))})")  # only "?" is pasted in, never user data
                values.extend(p.value for p in picks)
        if exclude_ids:
            clauses.append(f"id NOT IN ({','.join('?' * len(exclude_ids))})")
            values.extend(sorted(exclude_ids))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock:
            rows = self._conn.execute(f"SELECT json FROM monsters {where} ORDER BY rowid", values).fetchall()
        found = [m for m in (Monster.model_validate_json(row[0]) for row in rows) if matches(m, request)]
        return found if limit is None else found[:limit]

    # --- daily usage ------------------------------------------------------------------------------------

    def usage(self, day: str) -> Usage:
        with self._lock:
            row = self._conn.execute("SELECT calls, input_tokens, output_tokens FROM ai_usage WHERE day = ?", (day,)).fetchone()
        return Usage(*row) if row else Usage(0, 0, 0)

    def record_usage(self, day: str, calls: int = 0, input_tokens: int = 0, output_tokens: int = 0) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO ai_usage (day, calls, input_tokens, output_tokens) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(day) DO UPDATE SET calls = calls + excluded.calls, "
                "input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens",
                (day, calls, input_tokens, output_tokens),
            )

    # --- remembered reskins -----------------------------------------------------------------------------

    def reskin(self, key: str) -> Monster | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT m.json FROM reskins r JOIN monsters m ON m.id = r.monster_id WHERE r.key = ?", (key,)
            ).fetchone()
        return Monster.model_validate_json(row[0]) if row else None

    def remember_reskin(self, key: str, monster_id: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT OR REPLACE INTO reskins (key, monster_id) VALUES (?, ?)", (key, monster_id))
