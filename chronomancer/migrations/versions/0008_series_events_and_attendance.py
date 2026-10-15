"""one repeating Discord event per group, attendance answers, reschedule link; no quarterly

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        batch_op.add_column(sa.Column('series_event_id', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('series_event_sig', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('events_guild_id', sa.String(length=32), nullable=True))
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.add_column(sa.Column('rescheduled_from', sa.Integer(), nullable=True))
    op.create_table(
        'attendance',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('poll_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('answer', sa.String(length=3), nullable=False),
        sa.Column('answered_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['poll_id'], ['polls.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('poll_id', 'user_id'),
    )
    with op.batch_alter_table('attendance', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_attendance_poll_id'), ['poll_id'], unique=False)
    # Quarterly is not something Discord can repeat, so it is no longer offered: such groups
    # become one-off until someone picks a frequency again.
    op.execute("UPDATE campaigns SET cadence = 'none' WHERE cadence = 'quarterly'")


def downgrade() -> None:
    with op.batch_alter_table('attendance', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_attendance_poll_id'))
    op.drop_table('attendance')
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.drop_column('rescheduled_from')
    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        batch_op.drop_column('events_guild_id')
        batch_op.drop_column('series_event_sig')
        batch_op.drop_column('series_event_id')
