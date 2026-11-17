"""Kalendar bloklari (sql/049_time_blocks.sql)

Revision ID: 0048
Revises: 0047
"""
from pathlib import Path

from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "049_time_blocks.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
