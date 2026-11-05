"""Go'zallikka e'tibor: dorixona va klinika vaqtincha yashirin, Wellness & Spa (sql/031_focus_beauty.sql)

Revision ID: 0030
Revises: 0029
"""
from pathlib import Path

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "031_focus_beauty.sql").read_text(encoding="utf-8")
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError
