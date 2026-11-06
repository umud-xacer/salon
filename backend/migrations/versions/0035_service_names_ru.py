"""Xizmat va bo'limlarning ruscha nomi (name_ru), tavsiyalarga ruscha nomlar (sql/036_service_names_ru.sql)

Revision ID: 0035
Revises: 0034
"""
from pathlib import Path

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "036_service_names_ru.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
