"""Super Admin muassasani o'chiradi (sql/021_delete_business.sql)

Revision ID: 0020
Revises: 0019
"""
from pathlib import Path

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "021_delete_business.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
