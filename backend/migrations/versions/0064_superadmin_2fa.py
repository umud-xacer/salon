"""Super Admin 2FA: Telegram orqali kod (sql/065_superadmin_2fa.sql)

Revision ID: 0064
Revises: 0063
"""
from pathlib import Path

from alembic import op

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "065_superadmin_2fa.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
