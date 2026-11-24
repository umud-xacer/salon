"""Direktor o'zi ro'yxatdan o'tadi, Super Admin tasdiqlaydi, 5 kunlik sinov (sql/070_business_signup.sql)

Revision ID: 0069
Revises: 0068
"""
from pathlib import Path

from alembic import op

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "070_business_signup.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
