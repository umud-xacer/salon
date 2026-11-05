"""Stomatologiya: bo'limli tavsiya xizmatlar, mutaxassisliklar (sql/029_dental_presets.sql)

Revision ID: 0028
Revises: 0027
"""
from pathlib import Path

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "029_dental_presets.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
