"""Muassasa turi xodim nomi: Wellness & Spa - Mutaxassis (sql/034_staff_word.sql)

Revision ID: 0033
Revises: 0032
"""
from pathlib import Path

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "034_staff_word.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
