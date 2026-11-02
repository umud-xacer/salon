"""Ombor: harakat himoyasi, kam qoldiq ogohlantirishi (sql/014_inventory.sql)

Revision ID: 0013
Revises: 0012
"""
from pathlib import Path

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "014_inventory.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
