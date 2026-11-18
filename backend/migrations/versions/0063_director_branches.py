"""Direktor filial qo'shadi, filial imtiyozli davri (sql/064_director_branches.sql)

Revision ID: 0063
Revises: 0062
"""
from pathlib import Path

from alembic import op

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "064_director_branches.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
