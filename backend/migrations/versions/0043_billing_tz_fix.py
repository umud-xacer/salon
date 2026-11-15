"""Obuna: oy qo'shish Toshkent vaqtida (UTC bazada 1-sana xatosi) (sql/044_billing_tz_fix.sql)

Revision ID: 0043
Revises: 0042
"""
from pathlib import Path

from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "044_billing_tz_fix.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
