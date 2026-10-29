"""Testlar haqiqiy PostgreSQL (+PostGIS) da ishlaydi.

TEST_PG_ADMIN_URL — superuser ulanishi (standart: postgres@127.0.0.1:55432).
Har ishga tushirishda `platform_test` bazasi noldan yaratiladi.
"""
import itertools
import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

ADMIN_URL = os.environ.get("TEST_PG_ADMIN_URL", "postgresql+psycopg://postgres@127.0.0.1:55432/postgres")
DB_NAME = "platform_test"
BACKEND = Path(__file__).resolve().parents[1]

_admin = make_url(ADMIN_URL)
_host = f"{_admin.host}:{_admin.port or 5432}"
os.environ.update({
    "ENV": "test",
    "DATABASE_URL": f"postgresql+psycopg://app_api:test_api_Pw_123@{_host}/{DB_NAME}",
    "AUTH_DATABASE_URL": f"postgresql+psycopg://app_auth:test_auth_Pw_123@{_host}/{DB_NAME}",
    "MIGRATION_DATABASE_URL": _admin.set(database=DB_NAME).render_as_string(hide_password=False),
    "JWT_SECRET": "test-secret-0123456789-abcdefghijklmnop",
    "SMS_PROVIDER": "console",
})


def _recreate_database():
    engine = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with engine.connect() as c:
        c.exec_driver_sql(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)')
        c.exec_driver_sql(f'CREATE DATABASE "{DB_NAME}"')
    engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def database():
    from alembic import command
    from alembic.config import Config

    _recreate_database()
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    command.upgrade(cfg, "head")

    from app.cli import create_superadmin, setup_roles
    setup_roles()
    create_superadmin("+998900000001", "Super Admin", "SuperPass123")
    yield


@pytest.fixture(scope="session")
def client(database):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


_phones = itertools.count(1001)


def new_phone() -> str:
    return f"+99891{next(_phones):07d}"


def auth_header(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def otp_login(client, phone: str, name: str = "Test Foydalanuvchi") -> dict:
    r = client.post("/api/v1/auth/otp/request", json={"phone": phone})
    assert r.status_code == 200, r.text
    code = r.json()["dev_code"]
    r = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "full_name": name})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def superadmin(client) -> dict:
    r = client.post("/api/v1/auth/login", json={"phone": "+998900000001", "password": "SuperPass123"})
    assert r.status_code == 200, r.text
    return r.json()


def create_business(client, superadmin, *, modules=("booking",)) -> dict:
    """Biznes + egasi. Qaytaradi: business_id, owner tokenlari, owner_member_id."""
    owner_phone = new_phone()
    slug = f"biz-{owner_phone[-7:]}"
    r = client.post("/api/v1/superadmin/businesses", headers=auth_header(superadmin), json={
        "name": f"Salon {slug}", "slug": slug, "category_id": 1, "city": "Toshkent",
        "lat": 41.2995, "lng": 69.2401, "owner_phone": owner_phone, "owner_full_name": "Salon Egasi",
        "modules": list(modules),
    })
    assert r.status_code == 201, r.text
    biz = r.json()
    return {"id": biz["id"], "owner_member_id": biz["owner_member_id"], "owner": otp_login(client, owner_phone)}


def add_member(client, business, role: str, actor: dict | None = None) -> dict:
    phone = new_phone()
    r = client.post(f"/api/v1/businesses/{business['id']}/members",
                    headers=auth_header(actor or business["owner"]),
                    json={"phone": phone, "full_name": f"Xodim {role}", "role": role, "title": role})
    assert r.status_code == 201, r.text
    return {"member": r.json(), "tokens": otp_login(client, phone)}
