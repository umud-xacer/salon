"""Bildirishnomalarni faqat bazadagi funksiyalar yozadi (sql/027_close_notifications_insert.sql)

Revision ID: 0026
Revises: 0025
"""
from pathlib import Path

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "027_close_notifications_insert.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
