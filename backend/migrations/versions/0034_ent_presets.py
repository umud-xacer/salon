"""Lor (Otorinolaringologiya) turi: bo'limli tavsiya xizmatlar, mutaxassisliklar (sql/035_ent_presets.sql)

Revision ID: 0034
Revises: 0033
"""
from pathlib import Path

from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "035_ent_presets.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
