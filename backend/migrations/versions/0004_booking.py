"""Bron qilish, bekor qilish, ko'chirish (sql/005_booking.sql)

Revision ID: 0004
Revises: 0003
"""
from pathlib import Path

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "005_booking.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
