"""Copy the SQLite database safely while the app is running.

    python -m app.backup /data/backups/chronomancer-2026-10-15.db

Uses SQLite's own online-backup call, so the copy is consistent even if the website or the bot is
writing at that moment (copying the file with cp is not safe). Only SQLite is supported, which is
what Chronomancer runs on."""
import sqlite3
import sys
from pathlib import Path

from sqlalchemy.engine import make_url

from . import config


def database_file(url: str | None = None) -> Path:
    parsed = make_url(url or config.DATABASE_URL)
    if parsed.get_backend_name() != "sqlite" or not parsed.database or parsed.database == ":memory:":
        raise SystemExit("backup only supports a SQLite database file (DATABASE_URL=sqlite:///...)")
    return Path(parsed.database)


def backup_to(destination: str | Path, source: str | Path | None = None) -> Path:
    """Write a consistent copy of the database to `destination` and return its path."""
    source = Path(source) if source is not None else database_file()
    destination = Path(destination)
    if not source.is_file():
        raise SystemExit(f"no database at {source}")
    if destination.exists():
        raise SystemExit(f"{destination} already exists; refusing to overwrite a backup")
    destination.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
    dst = sqlite3.connect(destination)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return destination


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m app.backup <destination-file>")
    print(backup_to(sys.argv[1]))
