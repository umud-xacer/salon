"""Xonalar va kreslolar bandligi (sql/059_resources.sql)

Revision ID: 0058
Revises: 0057
"""
from pathlib import Path

from alembic import op

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "059_resources.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
