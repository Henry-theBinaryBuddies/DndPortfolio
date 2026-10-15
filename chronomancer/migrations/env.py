from alembic import context
from sqlalchemy import create_engine

from app import config, models  # noqa: F401  (importing models registers every table)
from app.db import Base

target_metadata = Base.metadata


def render_item(type_, obj, autogen_context):
    """Migrations must not depend on app classes that may change later. UTCDateTime is a
    plain DateTime in the database (it only converts values in Python), so render it as one."""
    if type_ == "type" and isinstance(obj, models.UTCDateTime):
        return "sa.DateTime()"
    return False


def run_migrations() -> None:
    # app.migrate hands in a live connection; the alembic CLI does not, so it builds one.
    connection = context.config.attributes.get("connection")
    engine = None
    if connection is None:
        engine = create_engine(config.DATABASE_URL)
        connection = engine.connect()
    try:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # SQLite cannot ALTER most things in place
            compare_type=True,
            render_item=render_item,
        )
        with context.begin_transaction():
            context.run_migrations()
        if engine is not None:
            connection.commit()
    finally:
        if engine is not None:
            connection.close()
            engine.dispose()


run_migrations()
