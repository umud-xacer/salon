"""Xodim va direktor parolini faqat rahbar beradi (sql/022_managed_passwords.sql)

Revision ID: 0020
Revises: 0020
"""
from pathlib import Path

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "022_managed_passwords.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
