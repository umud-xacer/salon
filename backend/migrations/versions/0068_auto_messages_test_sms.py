"""Avtomatik xabarlar: sinab ko'rish va SMS tayyorgarligi (sql/069_auto_messages_test_sms.sql)

Revision ID: 0068
Revises: 0067
"""
from pathlib import Path

from alembic import op

revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "069_auto_messages_test_sms.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
