"""Mijoz kartochkasi: tug'ilgan kun, jins, manba, teglar, ogohlantirish, eslatmalar (sql/050_client_card.sql)

Revision ID: 0049
Revises: 0048
"""
from pathlib import Path

from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "050_client_card.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
