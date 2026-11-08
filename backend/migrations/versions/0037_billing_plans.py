"""Tariflar (billing_plans) va muassasa tarifi (sql/038_billing_plans.sql)

Revision ID: 0037
Revises: 0036
"""
from pathlib import Path

from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "038_billing_plans.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
