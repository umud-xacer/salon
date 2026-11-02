"""Ombor: bir vaqtdagi chiqimlarda deadlock'ni bartaraf etish (sql/016_stock_lock.sql)

Revision ID: 0015
Revises: 0014
"""
from pathlib import Path

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "016_stock_lock.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
