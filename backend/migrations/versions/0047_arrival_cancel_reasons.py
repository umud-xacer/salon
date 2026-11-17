"""'Mijoz keldi' belgisi va bekor qilish sabablari (sql/048_arrival_cancel_reasons.sql)

Revision ID: 0047
Revises: 0046
"""
from pathlib import Path

from alembic import op

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "048_arrival_cancel_reasons.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
