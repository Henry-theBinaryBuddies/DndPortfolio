"""The database backup tool in deploy/: a consistent copy, and only the newest copies are kept."""

import importlib.util
import sqlite3
from datetime import datetime
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "deploy" / "backup_db.py"
spec = importlib.util.spec_from_file_location("backup_db", SCRIPT)
backup_db = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
spec.loader.exec_module(backup_db)  # type: ignore[union-attr]


def make_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE monsters (id TEXT PRIMARY KEY)")
    connection.execute("INSERT INTO monsters VALUES ('gen-test')")
    connection.commit()
    connection.close()


def test_a_backup_is_a_working_copy_of_the_database(tmp_path) -> None:
    database = tmp_path / "live.sqlite3"
    make_database(database)
    copy = backup_db.backup(database, tmp_path / "backups", now=datetime(2026, 11, 1, 3, 0, 0))
    assert copy.name == "cauldron-2026-11-01-030000.sqlite3"
    assert sqlite3.connect(copy).execute("SELECT id FROM monsters").fetchall() == [("gen-test",)]


def test_only_the_newest_copies_are_kept(tmp_path) -> None:
    database = tmp_path / "live.sqlite3"
    make_database(database)
    for day in range(1, 6):
        backup_db.backup(database, tmp_path / "backups", keep=3, now=datetime(2026, 11, day, 3, 0, 0))
    names = sorted(p.name for p in (tmp_path / "backups").glob("*.sqlite3"))
    assert names == ["cauldron-2026-11-03-030000.sqlite3", "cauldron-2026-11-04-030000.sqlite3", "cauldron-2026-11-05-030000.sqlite3"]


def test_a_missing_database_is_a_clear_error_and_creates_nothing(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        backup_db.backup(tmp_path / "nope.sqlite3", tmp_path / "backups")
    assert not (tmp_path / "backups").exists()


def test_the_backup_follows_the_database_the_server_uses(tmp_path) -> None:
    secrets = tmp_path / "secrets.env"
    secrets.write_text("\ufeffANTHROPIC_API_KEY=x\nCAULDRON_DATABASE=\"D:\\data\\live.sqlite3\"\n", encoding="utf-8")
    assert backup_db.database_in_use(secrets, env={}) == Path("D:\\data\\live.sqlite3")
    assert backup_db.database_in_use(secrets, env={"CAULDRON_DATABASE": "E:\\env.sqlite3"}) == Path("E:\\env.sqlite3")  # the environment wins
    assert backup_db.database_in_use(tmp_path / "missing.env", env={}) == backup_db.DEFAULT_DB


# --- the Ubuntu service files ----------------------------------------------------------------------------------

DEPLOY = Path(__file__).parents[2] / "deploy"


def unit(name: str) -> dict[str, list[str]]:
    """A systemd unit file as {key: [values]} (a key such as Environment may repeat). Section headers and comments are skipped."""
    found: dict[str, list[str]] = {}
    for line in (DEPLOY / name).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith(("#", "[")):
            key, _, value = line.partition("=")
            found.setdefault(key, []).append(value)
    return found


def test_the_server_runs_as_its_own_user_restarts_itself_and_reads_the_key_from_outside_the_project() -> None:
    service = unit("creature-cauldron.service")
    assert service["User"] == ["cauldron"] and service["Restart"] == ["always"]
    assert service["EnvironmentFile"] == ["/etc/cauldron/secrets.env"]
    assert service["ExecStart"][0].endswith("/backend/.venv/bin/python -m cauldron.service")
    assert not any("ANTHROPIC" in value or "sk-ant" in value for values in service.values() for value in values)  # no key in the unit
    assert service["Environment"].index("CAULDRON_TRUSTED_PROXY_HEADER=CF-Connecting-IP") >= 0
    assert "CAULDRON_ALLOWED_ORIGINS=https://creaturecauldron.com" in service["Environment"]


def test_the_server_is_locked_down_to_the_network_and_its_own_database_folder() -> None:
    service = unit("creature-cauldron.service")
    for setting in ("NoNewPrivileges", "PrivateTmp", "ProtectHome", "RestrictSUIDSGID"):
        assert service[setting] == ["true"]
    assert service["ProtectSystem"] == ["strict"] and service["StateDirectory"] == ["cauldron"]
    assert service["Environment"].count("CAULDRON_DATABASE=/var/lib/cauldron/cauldron.sqlite3") == 1


def test_the_nightly_backup_is_a_timer_that_catches_up_and_uses_the_same_database() -> None:
    assert unit("cauldron-backup.timer")["OnCalendar"] == ["*-*-* 03:00:00"] and unit("cauldron-backup.timer")["Persistent"] == ["true"]
    backup = unit("cauldron-backup.service")
    assert backup["Type"] == ["oneshot"] and backup["ExecStart"][0].endswith("/deploy/backup_db.py")
    assert backup["Environment"].count("CAULDRON_DATABASE=/var/lib/cauldron/cauldron.sqlite3") == 1


def test_the_unit_files_use_unix_line_endings_so_systemd_reads_them_cleanly() -> None:
    for name in ("creature-cauldron.service", "cauldron-backup.service", "cauldron-backup.timer"):
        assert b"\r" not in (DEPLOY / name).read_bytes(), name
