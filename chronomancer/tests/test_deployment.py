"""The deployment files (Docker image, Compose, Caddy, scripts, backup) agree with the app and with
each other. None of this needs Docker: it checks the files and the code they rely on."""
import importlib.metadata as metadata
import re
import sqlite3
from pathlib import Path

import pytest

from app import backup, config

ROOT = Path(__file__).resolve().parent.parent
DOCKERFILE = (ROOT / "Dockerfile").read_text(encoding="utf-8")
COMPOSE = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
CADDY = (ROOT / "deploy" / "Caddyfile").read_text(encoding="utf-8")
SETUP = (ROOT / "deploy" / "setup-vm.sh").read_text(encoding="utf-8")
BACKUP_SH = (ROOT / "deploy" / "backup.sh").read_text(encoding="utf-8")
DOCKERIGNORE = (ROOT / ".dockerignore").read_text(encoding="utf-8")
GITIGNORE = (ROOT / ".gitignore").read_text(encoding="utf-8")
GUIDE = (ROOT / "DEPLOY.md").read_text(encoding="utf-8")
LOCK = (ROOT / "requirements.lock.txt").read_text(encoding="utf-8")
PROD_ENV = (ROOT / ".env.production.example").read_text(encoding="utf-8")


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


# ------------------------------------------------ the backup


def make_db(path, rows=3):
    con = sqlite3.connect(path)
    con.execute("create table t (id integer primary key, v text)")
    con.executemany("insert into t (v) values (?)", [(f"row {i}",) for i in range(rows)])
    con.commit()
    return con


def test_a_backup_is_a_complete_valid_copy(tmp_path):
    make_db(tmp_path / "live.db", rows=5).close()
    out = backup.backup_to(tmp_path / "b" / "copy.db", source=tmp_path / "live.db")
    copy = sqlite3.connect(out)
    assert copy.execute("select count(*) from t").fetchone() == (5,)
    assert copy.execute("pragma integrity_check").fetchone() == ("ok",)


def test_a_backup_is_consistent_even_while_the_app_has_the_database_open(tmp_path):
    live = make_db(tmp_path / "live.db")
    live.execute("insert into t (v) values ('uncommitted')")      # a write in progress, not yet committed
    out = backup.backup_to(tmp_path / "copy.db", source=tmp_path / "live.db")
    assert sqlite3.connect(out).execute("select count(*) from t").fetchone() == (3,)
    live.commit()
    again = backup.backup_to(tmp_path / "copy2.db", source=tmp_path / "live.db")
    assert sqlite3.connect(again).execute("select count(*) from t").fetchone() == (4,)


def test_a_backup_never_overwrites_an_earlier_one(tmp_path):
    make_db(tmp_path / "live.db").close()
    backup.backup_to(tmp_path / "copy.db", source=tmp_path / "live.db")
    with pytest.raises(SystemExit, match="refusing to overwrite"):
        backup.backup_to(tmp_path / "copy.db", source=tmp_path / "live.db")


def test_a_backup_does_not_modify_the_live_database(tmp_path):
    make_db(tmp_path / "live.db").close()
    before = (tmp_path / "live.db").read_bytes()
    backup.backup_to(tmp_path / "copy.db", source=tmp_path / "live.db")
    assert (tmp_path / "live.db").read_bytes() == before


def test_a_missing_database_is_reported_clearly(tmp_path):
    with pytest.raises(SystemExit, match="no database at"):
        backup.backup_to(tmp_path / "copy.db", source=tmp_path / "nope.db")


@pytest.mark.parametrize("url", ["postgresql://u:p@host/db", "sqlite://", "sqlite:///:memory:"])
def test_only_a_sqlite_file_can_be_backed_up(url):
    with pytest.raises(SystemExit, match="only supports a SQLite database file"):
        backup.database_file(url)


def test_the_database_file_comes_from_database_url():
    assert backup.database_file("sqlite:////data/chronomancer.db") == Path("/data/chronomancer.db")
    assert backup.database_file("sqlite:///./x.db") == Path("./x.db")


# ------------------------------------------------ pinned dependencies


def pins():
    return {norm(m.group(1)): m.group(2) for m in re.finditer(r"^([A-Za-z0-9_.\-]+)==(\S+)$", LOCK, re.M)}


def test_every_pinned_version_is_what_the_tests_ran_against():
    """If this fails, you upgraded a package: re-run the suite, then refresh requirements.lock.txt."""
    for name, version in pins().items():
        try:
            installed = metadata.version(name)
        except metadata.PackageNotFoundError:
            continue  # a platform-specific package that is not needed on this machine
        assert installed == version, f"{name}: pinned {version}, installed {installed}"


def test_the_lock_covers_every_runtime_requirement_and_leaves_out_test_tools():
    required = {norm(re.split(r"[<>=!~\[ ]", line.strip(), maxsplit=1)[0])
                for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
                if line.strip() and not line.startswith("#")}
    required.discard("pytest")
    assert required <= set(pins()), required - set(pins())
    assert "pytest" not in pins() and "colorama" not in pins()


def test_the_lock_names_the_packages_the_bot_needs_on_a_modern_python():
    assert {"discord-py", "fastapi", "uvicorn", "sqlalchemy", "alembic", "tzdata", "audioop-lts"} <= set(pins())


# ------------------------------------------------ the image


def test_the_image_installs_the_pinned_list_and_never_copies_secrets_or_data():
    assert "COPY requirements.lock.txt" in DOCKERFILE and "pip install --prefer-binary -r requirements.lock.txt" in DOCKERFILE
    copied = re.findall(r"^COPY (\S+)", DOCKERFILE, re.M)
    assert set(copied) == {"requirements.lock.txt", "alembic.ini", "migrations", "app", "web"}
    for ignored in (".env", "*.db", "data/", ".venv/", "tests/"):
        assert ignored in DOCKERIGNORE.splitlines(), ignored


def test_the_image_runs_as_an_ordinary_user_that_owns_the_data_folder():
    assert re.search(r"useradd .*--uid 10001", DOCKERFILE) and "USER chronomancer" in DOCKERFILE
    assert "chown chronomancer /data" in DOCKERFILE
    assert "chown -R 10001:10001 data" in SETUP        # the host folder the container writes to matches that uid


def test_the_server_starts_the_way_a_proxy_needs():
    cmd = DOCKERFILE[DOCKERFILE.index("CMD ["):]
    assert '"app.main:app"' in cmd and '"--proxy-headers"' in cmd and '"--forwarded-allow-ips", "*"' in cmd
    assert "DATABASE_URL=sqlite:////data/chronomancer.db" in DOCKERFILE


def test_the_health_check_hits_a_route_that_exists(client):
    assert "/api/config" in DOCKERFILE
    assert client.get("/api/config").status_code == 200


def test_the_app_only_needs_files_the_image_copies():
    assert (config.ROOT / "web" / "index.html").is_file() and (config.ROOT / "alembic.ini").is_file()
    assert (config.ROOT / "migrations").is_dir() and (config.ROOT / "app" / "main.py").is_file()


# ------------------------------------------------ compose and caddy


def test_the_app_is_never_published_only_the_proxy_is():
    app_block = COMPOSE[COMPOSE.index("  app:"):COMPOSE.index("  caddy:")]
    assert "ports:" not in app_block and 'expose:\n      - "8000"' in app_block
    caddy_block = COMPOSE[COMPOSE.index("  caddy:"):]
    assert '"80:80"' in caddy_block and '"443:443"' in caddy_block


def test_compose_keeps_the_data_and_restarts_everything_on_failure_or_reboot():
    assert COMPOSE.count("restart: unless-stopped") == 2
    assert "env_file: .env" in COMPOSE and "- ./data:/data" in COMPOSE
    assert "${SITE_ADDRESS:?" in COMPOSE                     # refuses to start without an address
    assert "condition: service_healthy" in COMPOSE and "max-size" in COMPOSE


def test_caddy_proxies_to_the_app_and_adds_basic_security_headers():
    assert "{$SITE_ADDRESS}" in CADDY and "reverse_proxy app:8000" in CADDY
    for header in ("Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"):
        assert header in CADDY


# ------------------------------------------------ scripts and settings


def test_the_scripts_do_what_the_guide_says():
    assert "python -m app.backup" in BACKUP_SH and "tail -n +15" in BACKUP_SH and "BACKUP_BUCKET" in BACKUP_SH
    assert "set -euo pipefail" in BACKUP_SH and "set -euo pipefail" in SETUP
    for needed in ("docker-ce", "docker-compose-plugin", "download.docker.com/linux/${ID}", "unattended-upgrades", "/swapfile"):
        assert needed in SETUP
    assert "docker-compose-v2" not in SETUP and "docker.io" not in SETUP      # Ubuntu-only packages: they broke Debian
    assert 'case "${ID}" in' in SETUP and "debian|ubuntu" in SETUP


def test_every_setting_the_app_reads_is_documented_for_production():
    names = set(re.findall(r'os\.environ\.get\("([A-Z_]+)"', (ROOT / "app" / "config.py").read_text(encoding="utf-8")))
    optional_switches = {"CHRONOMANCER_AUTO_MIGRATE", "CHRONOMANCER_BACKGROUND", "CHRONOMANCER_BOT",
                         "CHRONOMANCER_COMPACT", "DATABASE_URL"}   # tests and tuning only; compose sets the database
    for name in names - optional_switches:
        assert name in PROD_ENV, f"{name} is read by the app but missing from .env.production.example"


def test_the_production_example_never_turns_dev_mode_on_or_contains_secrets():
    assert not re.search(r"^CHRONOMANCER_DEV=1", PROD_ENV, re.M)
    for key in ("SECRET_KEY", "DISCORD_BOT_TOKEN", "DISCORD_CLIENT_SECRET"):
        assert re.search(rf"^{key}=$", PROD_ENV, re.M), f"{key} must be blank in the example"


def test_secrets_and_data_stay_out_of_git():
    lines = GITIGNORE.splitlines()
    assert ".env" in lines and "*.db" in lines and "data/" in lines


# ------------------------------------------------ the guide


def test_the_guide_covers_every_step_a_first_deployment_needs():
    for needed in ("e2-micro", "us-central1", "pd-standard", "docker compose up -d --build", "setup-vm.sh",
                   "/auth/callback", "/privacy.html", "/terms.html", "backup.sh", "git pull",
                   "SITE_ADDRESS", "PUBLIC_BASE_URL", "budget", "sslip.io"):
        assert needed in GUIDE, needed
