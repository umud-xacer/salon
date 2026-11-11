"""Ochiq tariflar funksiyasi — landing narxlari (sql/039_public_plans.sql)

Revision ID: 0038
Revises: 0037
"""
from pathlib import Path

from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "039_public_plans.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
