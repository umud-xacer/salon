"""Onlayn obuna to'lovi: Payme va Click, paketlar, muassasa oylik narxi (sql/037_billing.sql)

Revision ID: 0036
Revises: 0035
"""
from pathlib import Path

from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "037_billing.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
