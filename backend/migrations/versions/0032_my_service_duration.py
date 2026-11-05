"""Usta o'z xizmati davomiyligini sozlaydi (sql/033_my_service_duration.sql)

Revision ID: 0032
Revises: 0031
"""
from pathlib import Path

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "033_my_service_duration.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
