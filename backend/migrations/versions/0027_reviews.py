"""Reyting va baholash (sql/028_reviews.sql)

Revision ID: 0027
Revises: 0026
"""
from pathlib import Path

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "028_reviews.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
