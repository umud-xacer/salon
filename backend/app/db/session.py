"""Baza ulanishlari.

ApiSession  — app_api roli. Har bir tranzaksiya boshida `app.user_id` o'rnatiladi va
              PostgreSQL RLS siyosatlari shu foydalanuvchiga qarab qatorlarni filtrlaydi.
AuthSession — app_auth roli, faqat kirish jarayoni uchun (users, otp_codes, refresh_tokens).
"""
from functools import lru_cache

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def _api_engine():
    return create_engine(get_settings().database_url, pool_pre_ping=True)


@lru_cache
def _auth_engine():
    return create_engine(get_settings().auth_database_url, pool_pre_ping=True)


@lru_cache
def _worker_engine():
    url = get_settings().worker_database_url
    if not url:
        raise RuntimeError("WORKER_DATABASE_URL o'rnatilmagan")
    return create_engine(url, pool_pre_ping=True)


ApiSession = sessionmaker(expire_on_commit=False)
AuthSession = sessionmaker(expire_on_commit=False)
WorkerSession = sessionmaker(expire_on_commit=False)


@event.listens_for(ApiSession, "after_begin")
def _set_rls_user(session: Session, transaction, connection):
    # is_local=true — qiymat faqat shu tranzaksiya ichida amal qiladi,
    # ulanish pulga qaytganda boshqa foydalanuvchiga o'tib ketmaydi.
    uid = session.info.get("user_id")
    connection.execute(
        text("SELECT set_config('app.user_id', :uid, true)"),
        {"uid": str(uid) if uid else ""},
    )


def api_session(user_id: int | None) -> Session:
    return ApiSession(bind=_api_engine(), info={"user_id": user_id})


def worker_session() -> Session:
    return WorkerSession(bind=_worker_engine())


def auth_session() -> Session:
    return AuthSession(bind=_auth_engine())
