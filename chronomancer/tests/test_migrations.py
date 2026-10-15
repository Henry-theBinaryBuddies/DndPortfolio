"""Migrations must produce exactly the schema the models describe, keep existing data when
adopting a pre-migration database, and be runnable repeatedly."""
import sqlite3

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app import config, db as dbmod, migrate


@pytest.fixture()
def engine(tmp_path):
    eng = create_engine(f"sqlite:///{(tmp_path / 'm.db').as_posix()}")
    yield eng
    eng.dispose()


def schema_drift(engine) -> list:
    """Differences between the migrated database and the models (empty means identical)."""
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        return compare_metadata(ctx, dbmod.Base.metadata)


def test_a_fresh_database_is_built_by_migrations_and_matches_the_models(engine):
    migrate.upgrade(engine)
    tables = set(inspect(engine).get_table_names())
    assert {"users", "campaigns", "polls", "reminders", "notifications", "alembic_version"} <= tables
    assert schema_drift(engine) == []  # a model change without a migration fails here


def test_running_migrations_twice_is_harmless(engine):
    migrate.upgrade(engine)
    migrate.upgrade(engine)
    with engine.connect() as conn:
        assert conn.execute(text("select count(*) from alembic_version")).scalar() == 1


def test_there_is_a_single_linear_history():
    scripts = ScriptDirectory(str(config.ROOT / "migrations"))
    assert len(scripts.get_heads()) == 1
    revisions = list(scripts.walk_revisions())
    assert revisions[-1].revision == migrate.BASELINE and revisions[-1].down_revision is None


def legacy_database_at(engine, revision):
    """A database as the old startup left it: the tables of `revision` and no version table."""
    from alembic import command

    with engine.begin() as conn:
        command.upgrade(migrate.alembic_config(conn), revision)
        conn.execute(text("drop table alembic_version"))
    assert "alembic_version" not in inspect(engine).get_table_names()


def test_an_old_pre_migration_database_is_adopted_and_upgraded_keeping_its_data(engine):
    legacy_database_at(engine, migrate.BASELINE)  # the schema before the timezone column existed
    with engine.begin() as conn:
        conn.execute(text("insert into users (id, discord_id, display_name, timezone) "
                          "values (1, '42', 'Aria', 'UTC')"))
        conn.execute(text("insert into campaigns (name, owner_id, cadence, default_duration_min, "
                          "min_quorum, vote_top_n, reminder_offsets_min, theme, invite_code) "
                          "values ('Strahd', 1, 'none', 180, 2, 3, '[1440, 60]', 'dnd', 'code1')"))
    migrate.upgrade(engine)
    with engine.connect() as conn:
        assert conn.execute(text("select display_name from users where discord_id='42'")).scalar() == "Aria"
        assert conn.execute(text("select name from campaigns")).scalar() == "Strahd"  # kept
        columns = {c["name"] for c in inspect(conn).get_columns("campaigns")}
        assert "timezone" not in columns and "events_enabled" in columns  # old column gone, new ones in
    assert schema_drift(engine) == []


def test_a_pre_migration_database_built_by_current_code_is_adopted_as_up_to_date(engine):
    """create_all from today's models already has every column: it must not be re-migrated."""
    dbmod.Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("insert into users (discord_id, display_name, timezone) "
                          "values ('42', 'Aria', 'UTC')"))
    migrate.upgrade(engine)
    with engine.connect() as conn:
        assert conn.execute(text("select display_name from users")).scalar() == "Aria"
        head = ScriptDirectory(str(config.ROOT / "migrations")).get_current_head()
        assert conn.execute(text("select version_num from alembic_version")).scalar() == head
    assert schema_drift(engine) == []


def test_the_baseline_round_trips_down_and_up(engine):
    from alembic import command

    migrate.upgrade(engine)
    with engine.begin() as conn:
        cfg = migrate.alembic_config(conn)
        command.downgrade(cfg, "base")
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
    migrate.upgrade(engine)
    assert schema_drift(engine) == []


def test_the_app_uses_migrations_at_startup_unless_a_test_opts_out(engine, monkeypatch):
    monkeypatch.setattr(config, "AUTO_MIGRATE", True)
    monkeypatch.setattr(dbmod, "engine", engine)
    dbmod.init_db()
    assert "alembic_version" in inspect(engine).get_table_names()
