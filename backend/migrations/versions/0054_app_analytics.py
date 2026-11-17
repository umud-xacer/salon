"""Ilova analitikasi (sql/055_app_analytics.sql)

Revision ID: 0054
Revises: 0053
"""
from pathlib import Path

from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "055_app_analytics.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
