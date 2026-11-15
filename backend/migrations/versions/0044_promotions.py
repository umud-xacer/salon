"""Aksiyalar: bo'sh soatlarga chegirma, promokodlar, sodiqlik dasturi (sql/045_promotions.sql)

Revision ID: 0044
Revises: 0043
"""
from pathlib import Path

from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "045_promotions.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
