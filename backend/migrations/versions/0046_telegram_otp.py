"""Telegram chat_id: tasdiqlash kodi bot orqali (sql/047_telegram_otp.sql)

Revision ID: 0046
Revises: 0045
"""
from pathlib import Path

from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "047_telegram_otp.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
