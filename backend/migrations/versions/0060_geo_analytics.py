"""Hududiy analitika (sql/061_geo_analytics.sql)

Revision ID: 0060
Revises: 0059
"""
from pathlib import Path

from alembic import op

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "061_geo_analytics.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
