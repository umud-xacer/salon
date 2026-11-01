"""Obuna: is_active, subscription_ends_at, sms moduli (sql/009_subscription.sql)

Revision ID: 0008
Revises: 0007
"""
from pathlib import Path

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "009_subscription.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
