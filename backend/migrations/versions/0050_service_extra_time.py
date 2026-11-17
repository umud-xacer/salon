"""Xizmatga qo'shimcha vaqt: kutish va bufer (sql/051_service_extra_time.sql)

Revision ID: 0050
Revises: 0049
"""
from pathlib import Path

from alembic import op

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "051_service_extra_time.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
