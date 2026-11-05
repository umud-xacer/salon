"""Wellness & Spa ichki bo'limlari: bo'limli tavsiya xizmatlar (sql/032_wellness_presets.sql)

Revision ID: 0031
Revises: 0030
"""
from pathlib import Path

from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "032_wellness_presets.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
