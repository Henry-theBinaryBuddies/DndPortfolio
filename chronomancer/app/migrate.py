"""Applies database migrations. Called at startup, so deploying new code upgrades the schema."""
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import inspect

from . import config, models  # noqa: F401  (models register the tables to compare against)
from .db import Base

BASELINE = "0001"  # the schema as it stood before migrations existed


def alembic_config(connection) -> Config:
    cfg = Config(str(config.ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(config.ROOT / "migrations"))
    cfg.attributes["connection"] = connection
    return cfg


def upgrade(engine) -> None:
    """Bring the database to the latest schema.

    - A new, empty database is built by running every migration.
    - A database made before migrations existed (tables but no alembic_version) is adopted
      with its data kept: if its schema already matches the models (it was built by recent
      code) it is stamped as up to date, otherwise it is stamped as the baseline and upgraded.
    """
    with engine.begin() as connection:
        cfg = alembic_config(connection)
        tables = set(inspect(connection).get_table_names())
        if "alembic_version" not in tables and "users" in tables:
            drift = compare_metadata(
                MigrationContext.configure(connection, opts={"compare_type": True}), Base.metadata)
            command.stamp(cfg, BASELINE if drift else "head")
        command.upgrade(cfg, "head")
