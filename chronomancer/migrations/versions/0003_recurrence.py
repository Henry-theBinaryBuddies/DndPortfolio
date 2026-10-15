"""recurrence: polls remember whether their follow-up was handled and what they repeat

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.add_column(sa.Column('recurrence_handled', sa.Boolean(), nullable=False,
                                      server_default=sa.text('1')))
        batch_op.add_column(sa.Column('recurred_from', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('anchor_day', sa.Integer(), nullable=True))
    # Every poll that exists now is history. Marked handled (the server default above), so the
    # first run of the new code does not announce a flurry of "next sessions" for old ones.
    # From here on new polls start unhandled.
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.alter_column('recurrence_handled', existing_type=sa.Boolean(), nullable=False,
                              server_default=sa.text('0'))


def downgrade() -> None:
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.drop_column('anchor_day')
        batch_op.drop_column('recurred_from')
        batch_op.drop_column('recurrence_handled')
