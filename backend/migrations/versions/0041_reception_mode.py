"""Qabulxona rejimi: xodim huquqlari Administrator bor-yo'qligiga qarab (sql/042_reception_mode.sql)

Revision ID: 0041
Revises: 0040
"""
from pathlib import Path

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "042_reception_mode.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
