"""Applies database migrations. Called at startup, so deploying new code upgrades the schema."""
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from . import config

BASELINE = "0001"  # the schema as it stood before migrations existed


def alembic_config(connection) -> Config:
    cfg = Config(str(config.ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(config.ROOT / "migrations"))
    cfg.attributes["connection"] = connection
    return cfg


def upgrade(engine) -> None:
    """Bring the database to the latest schema.

    - A new, empty database is built by running every migration.
    - A database made before migrations existed (tables but no alembic_version) is stamped as
      the baseline and then upgraded, so existing data is kept.
    """
    with engine.begin() as connection:
        cfg = alembic_config(connection)
        tables = set(inspect(connection).get_table_names())
        if "alembic_version" not in tables and "users" in tables:
            command.stamp(cfg, BASELINE)
        command.upgrade(cfg, "head")
