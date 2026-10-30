"""Boshqaruv buyruqlari (jadvallar egasi — MIGRATION_DATABASE_URL bilan ishlaydi).

    python -m app.cli setup-roles
        app_api / app_auth / app_worker rollariga LOGIN va parol beradi
        (parollar DATABASE_URL, AUTH_DATABASE_URL va WORKER_DATABASE_URL dan).
    python -m app.cli sms-check [--phone +998901234567] [--text "..."]
        Eskiz hisobini tekshiradi.
    python -m app.cli create-superadmin --phone +998901234567 --name "Ism Familiya"
        Super Admin yaratadi. Parol so'raladi (ekranda ko'rinmaydi).

Super Admin bayrog'ini API orqali o'rnatib bo'lmaydi (bazadagi guard_users triggeri) — faqat shu buyruq orqali.
"""
import argparse
import getpass
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.core.security import hash_password, normalize_phone, validate_password_strength


def _owner_engine():
    url = get_settings().migration_database_url
    if not url:
        sys.exit("MIGRATION_DATABASE_URL o'rnatilmagan")
    return create_engine(url)


def setup_roles() -> None:
    s = get_settings()
    with _owner_engine().begin() as conn:
        for dsn in filter(None, (s.database_url, s.auth_database_url, s.worker_database_url)):
            url = make_url(dsn)
            if url.username not in ("app_api", "app_auth", "app_worker") or not url.password:
                sys.exit(f"URL foydalanuvchisi app_api/app_auth/app_worker va parolli bo'lishi kerak: {url.username}")
            # Parol identifikator emas, satr literal sifatida qo'yiladi
            pw = conn.exec_driver_sql("SELECT quote_literal(%s)", (url.password,)).scalar()
            conn.exec_driver_sql(f'ALTER ROLE "{url.username}" LOGIN PASSWORD {pw}')
            conn.exec_driver_sql(f'GRANT CONNECT ON DATABASE "{url.database}" TO "{url.username}"')
    print("Rollar sozlandi")


def create_superadmin(phone: str, name: str, password: str | None) -> None:
    phone = normalize_phone(phone)
    password = password or getpass.getpass("Parol: ")
    validate_password_strength(password)
    with _owner_engine().begin() as conn:
        uid = conn.execute(text("""
            INSERT INTO users (phone, full_name, password_hash, is_superadmin)
            VALUES (:phone, :name, :ph, true)
            ON CONFLICT (phone) DO UPDATE
               SET is_superadmin = true, password_hash = EXCLUDED.password_hash,
                   token_version = users.token_version + 1
            RETURNING id
        """), {"phone": phone, "name": name, "ph": hash_password(password)}).scalar()
    print(f"Super Admin tayyor: id={uid} {phone}")


def sms_check(phone: str | None, text: str) -> None:
    """Eskiz hisobini tekshiradi: login, keyin (--phone berilsa) bitta haqiqiy SMS. SMS pullik."""
    from app.services import sms
    try:
        sms._login()
        print("Eskiz login: OK")
        if phone:
            sms._send_eskiz(normalize_phone(phone), text)
            print("SMS yuborildi")
    except sms.SmsError as e:
        sys.exit(f"Xato: {e}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup-roles")
    sa = sub.add_parser("create-superadmin")
    sa.add_argument("--phone", required=True)
    sa.add_argument("--name", required=True)
    sa.add_argument("--password", help="faqat avtomatlashtirish uchun; odatda so'raladi")
    sc = sub.add_parser("sms-check")
    sc.add_argument("--phone", help="berilsa, shu raqamga bitta haqiqiy SMS ketadi")
    sc.add_argument("--text", default="Bu Eskiz dan test", help="Eskiz'da tasdiqlangan matn")
    args = p.parse_args(argv)

    if args.cmd == "setup-roles":
        setup_roles()
    elif args.cmd == "create-superadmin":
        create_superadmin(args.phone, args.name, args.password)
    elif args.cmd == "sms-check":
        sms_check(args.phone, args.text)


if __name__ == "__main__":
    main()
