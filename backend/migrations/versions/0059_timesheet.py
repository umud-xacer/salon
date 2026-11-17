"""Xodimlar tabeli (sql/060_timesheet.sql)

Revision ID: 0059
Revises: 0058
"""
from pathlib import Path

from alembic import op

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "060_timesheet.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
