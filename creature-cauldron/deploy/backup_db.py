"""Makes a safe copy of the server's database: ``python deploy/backup_db.py``.

The database holds every monster the forge has generated (the shared library) and the day's spend count, so it is worth keeping.
Copying the file while the server runs can catch it half-written; SQLite's own backup call makes a consistent copy instead.
Keeps the newest `--keep` copies and removes older ones. Standard library only.
"""

import argparse
import os
import sqlite3
from datetime import datetime
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_DB = PROJECT / "backend" / "data" / "cauldron.sqlite3"
DEFAULT_TO = Path(r"C:\cauldron\backups")
DEFAULT_SECRETS = Path(r"C:\cauldron\secrets.env")


def database_in_use(secrets_file: Path = DEFAULT_SECRETS, env: dict[str, str] | None = None) -> Path:
    """The database the server uses: CAULDRON_DATABASE from the environment or the secrets file (the same file run-server.ps1
    reads), else the default. A backup of the wrong file would look fine and protect nothing."""
    env = dict(os.environ if env is None else env)
    if "CAULDRON_DATABASE" not in env and secrets_file.exists():
        for line in secrets_file.read_text(encoding="utf-8-sig").splitlines():
            name, _, value = line.strip().partition("=")
            if name.strip() == "CAULDRON_DATABASE" and value.strip():
                env["CAULDRON_DATABASE"] = value.strip().strip("\"'")
    return Path(env["CAULDRON_DATABASE"]) if env.get("CAULDRON_DATABASE") else DEFAULT_DB


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
    parser.add_argument("--db", type=Path, default=None, help="the database (default: the one the server uses)")
    parser.add_argument("--to", type=Path, default=DEFAULT_TO)
    parser.add_argument("--keep", type=int, default=14)
    args = parser.parse_args()
    print(f"Saved {backup(args.db or database_in_use(), args.to, args.keep)}")


if __name__ == "__main__":
    main()
