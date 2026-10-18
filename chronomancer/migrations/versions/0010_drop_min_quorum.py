"""drop the minimum-free-players setting: the best times are always offered

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa


revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.drop_column('min_quorum')

    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        batch_op.drop_column('min_quorum')


def downgrade() -> None:
    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        batch_op.add_column(sa.Column('min_quorum', sa.INTEGER(), server_default=sa.text('2'), nullable=False))

    with op.batch_alter_table('polls', schema=None) as batch_op:
        batch_op.add_column(sa.Column('min_quorum', sa.INTEGER(), server_default=sa.text('2'), nullable=False))
