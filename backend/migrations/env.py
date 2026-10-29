from alembic import context
from sqlalchemy import create_engine

from app.core.config import get_settings

url = context.config.get_main_option("sqlalchemy.url") or get_settings().migration_database_url
if not url:
    raise RuntimeError("MIGRATION_DATABASE_URL o'rnatilmagan")

engine = create_engine(url)
with engine.connect() as connection:
    context.configure(connection=connection, transaction_per_migration=True)
    with context.begin_transaction():
        context.run_migrations()
engine.dispose()
