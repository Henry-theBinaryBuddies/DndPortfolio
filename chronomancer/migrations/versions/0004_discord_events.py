"""discord events: campaigns opt in (on by default); polls remember their Discord event

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        # On for existing campaigns too: events are automatic unless a campaign turns them off.
        batch_op.add_column(sa.Column('events_enabled', sa.Boolean(), nullable=False,
                                      server_default=sa.text('1')))
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.add_column(sa.Column('discord_event_id', sa.String(length=32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.drop_column('discord_event_id')
    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        batch_op.drop_column('events_enabled')
