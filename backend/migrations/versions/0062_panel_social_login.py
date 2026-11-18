"""Biznes paneliga Telegram va Google orqali kirish (sql/063_panel_social_login.sql)

Revision ID: 0062
Revises: 0061
"""
from pathlib import Path

from alembic import op

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "063_panel_social_login.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
