"""members can leave

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('members', schema=None) as batch_op:
        batch_op.add_column(sa.Column('left_at', sa.DateTime(), nullable=True))



def downgrade() -> None:
    with op.batch_alter_table('members', schema=None) as batch_op:
        batch_op.drop_column('left_at')

