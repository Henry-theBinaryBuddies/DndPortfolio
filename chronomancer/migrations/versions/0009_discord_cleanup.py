"""discord cleanup: events and vote messages to remove after a group is deleted

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'discord_cleanup',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=8), nullable=False),
        sa.Column('guild_id', sa.String(length=32), nullable=True),
        sa.Column('channel_id', sa.String(length=32), nullable=True),
        sa.Column('target_id', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('processed_at', sa.DateTime(), nullable=True),
        sa.Column('retry_after', sa.DateTime(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('error', sa.String(length=300), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('discord_cleanup')
