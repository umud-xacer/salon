"""Tasdiqlanmagan bronlarni avtomatik bekor qilish (sql/030_expire_pending.sql)

Revision ID: 0029
Revises: 0028
"""
from pathlib import Path

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "030_expire_pending.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
