"""Salon viloyati (sql/017_region.sql)

Revision ID: 0016
Revises: 0015
"""
from pathlib import Path

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "017_region.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
