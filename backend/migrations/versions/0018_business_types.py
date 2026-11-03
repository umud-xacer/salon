"""Muassasa turlari: dorixona, tavsiya xizmatlar, standart ish vaqti (sql/019_business_types.sql)

Revision ID: 0018
Revises: 0017
"""
from pathlib import Path

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "019_business_types.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
