"""Tashrif qatorlari, oldindan to'lov, avanslar, tezkor qabul (sql/040_visit_lines_advances.sql)

Revision ID: 0039
Revises: 0038
"""
from pathlib import Path

from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "040_visit_lines_advances.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
