"""Boshlang'ich sxema va xavfsizlik (sql/001_schema.sql, sql/002_security.sql)

Revision ID: 0001
Revises:
"""
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"


def _run_sql_file(name: str) -> None:
    sql = (SQL_DIR / name).read_text(encoding="utf-8")
    # To'g'ridan-to'g'ri psycopg orqali: SQL ichidagi ':' va '%' parametr deb talqin qilinmasin
    op.get_bind().connection.driver_connection.execute(sql)


def upgrade() -> None:
    _run_sql_file("001_schema.sql")
    _run_sql_file("002_security.sql")


def downgrade() -> None:
    raise NotImplementedError("Boshlang'ich migratsiyani orqaga qaytarib bo'lmaydi")
