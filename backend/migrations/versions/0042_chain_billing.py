"""Tarmoq obunasi: filial chegirmasi, pullik modullar, 1-sanaga to'g'rilash (sql/043_chain_billing.sql)

Revision ID: 0042
Revises: 0041
"""
from pathlib import Path

from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "043_chain_billing.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
