"""Xodim parolini direktor yoki Super Admin o'rnatishi (sql/011_member_password.sql)

Revision ID: 0010
Revises: 0009
"""
from pathlib import Path

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "011_member_password.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
