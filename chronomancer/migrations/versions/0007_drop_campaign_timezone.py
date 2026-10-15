"""drop campaign timezone

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        batch_op.drop_column('timezone')



def downgrade() -> None:
    with op.batch_alter_table('campaigns', schema=None) as batch_op:
        batch_op.add_column(sa.Column('timezone', sa.VARCHAR(length=64), server_default=sa.text("'UTC'"), nullable=False))

