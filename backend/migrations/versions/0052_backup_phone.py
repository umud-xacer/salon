"""Zaxira telefon va raqamni tasdiqlash (sql/053_backup_phone.sql)

Revision ID: 0052
Revises: 0051
"""
from pathlib import Path

from alembic import op

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "053_backup_phone.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
