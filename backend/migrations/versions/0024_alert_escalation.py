"""Ogohlantirish bron vaqtiga 20 daqiqa qolganda, qabulxona va direktorga ham (sql/025_alert_escalation.sql)

Revision ID: 0020
Revises: 0023
"""
from pathlib import Path

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "025_alert_escalation.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
