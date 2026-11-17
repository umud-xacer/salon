"""Kutish ro'yxati (sql/052_waitlist.sql)

Revision ID: 0051
Revises: 0050
"""
from pathlib import Path

from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "052_waitlist.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
