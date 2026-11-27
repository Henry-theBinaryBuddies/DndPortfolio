"""sessions the organizer moved: remember the old time and the series time

Revision ID: 0011
Revises: 0010
"""
from alembic import op
import sqlalchemy as sa


revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.add_column(sa.Column('moved_from_utc', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('series_start_utc', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.drop_column('series_start_utc')
        batch_op.drop_column('moved_from_utc')
