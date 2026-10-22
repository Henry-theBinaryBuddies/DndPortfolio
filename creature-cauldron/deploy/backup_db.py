"""Makes a safe copy of the server's database: ``python deploy/backup_db.py``.

The database holds every monster the forge has generated (the shared library) and the day's spend count, so it is worth keeping.
Copying the file while the server runs can catch it half-written; SQLite's own backup call makes a consistent copy instead.
Keeps the newest `--keep` copies and removes older ones. Standard library only.
"""

import argparse
import sqlite3
from datetime import datetime
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_DB = PROJECT / "backend" / "data" / "cauldron.sqlite3"
DEFAULT_TO = Path(r"C:\cauldron\backups")


def backup(database: Path, folder: Path, keep: int = 14, now: datetime | None = None) -> Path:
    """Copies `database` into `folder` as cauldron-<date and time>.sqlite3 and prunes old copies. Returns the new file."""
    if not database.exists():
        raise FileNotFoundError(f"No database at {database}")
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"cauldron-{(now or datetime.now()):%Y-%m-%d-%H%M%S}.sqlite3"
    source = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        destination = sqlite3.connect(target)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
    for old in sorted(folder.glob("cauldron-*.sqlite3"))[:-keep]:
        old.unlink()
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="Back up the Creature Cauldron database.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--to", type=Path, default=DEFAULT_TO)
    parser.add_argument("--keep", type=int, default=14)
    args = parser.parse_args()
    print(f"Saved {backup(args.db, args.to, args.keep)}")


if __name__ == "__main__":
    main()
