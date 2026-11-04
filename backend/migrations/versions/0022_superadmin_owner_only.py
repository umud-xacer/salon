"""Super Admin faqat direktor parolini ko'radi (sql/023_superadmin_owner_only.sql)

Revision ID: 0020
Revises: 0021
"""
from pathlib import Path

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "023_superadmin_owner_only.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
