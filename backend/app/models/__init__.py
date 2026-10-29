"""SQLAlchemy modellari. Sxemaning manbai — sql/*.sql; bu yerda faqat kod ishlatadigan ustunlar.
Standart qiymatlar va cheklovlar bazada (server_default), shuning uchun ular bu yerda takrorlanmaydi."""
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, ForeignKey, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import INET, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


UserStatus = Enum("active", "blocked", "deleted", name="user_status", create_type=False)
BusinessStatus = Enum("pending", "active", "blocked", name="business_status", create_type=False)
MemberRole = Enum("owner", "manager", "receptionist", "staff", name="member_role", create_type=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    phone: Mapped[str] = mapped_column(String(13))
    email: Mapped[str | None] = mapped_column(String)
    password_hash: Mapped[str | None] = mapped_column(Text)
    full_name: Mapped[str] = mapped_column(String(120), server_default="")
    avatar_url: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(5), server_default="uz")
    is_superadmin: Mapped[bool] = mapped_column(Boolean, server_default="false")
    status: Mapped[str] = mapped_column(UserStatus, server_default="active")
    token_version: Mapped[int] = mapped_column(Integer, server_default="0")
    failed_login_attempts: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()")


class OtpCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    phone: Mapped[str] = mapped_column(String(13))
    code_hash: Mapped[str] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    ip: Mapped[str | None] = mapped_column(INET)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    token_hash: Mapped[str] = mapped_column(Text)
    replaced_by: Mapped[int | None] = mapped_column(BigInteger)
    user_agent: Mapped[str | None] = mapped_column(String(200))
    ip: Mapped[str | None] = mapped_column(INET)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()")


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    category_id: Mapped[int] = mapped_column(SmallInteger)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140))
    phone: Mapped[str | None] = mapped_column(String(13))
    city: Mapped[str | None] = mapped_column(String(80))
    address: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(BusinessStatus, server_default="pending")
    is_listed: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_by: Mapped[int | None] = mapped_column(BigInteger)


class BusinessMember(Base):
    __tablename__ = "business_members"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    business_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("businesses.id"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(MemberRole)
    title: Mapped[str | None] = mapped_column(String(80))
    is_bookable: Mapped[bool] = mapped_column(Boolean, server_default="true")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")


class MemberPermission(Base):
    __tablename__ = "member_permissions"

    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("business_members.id"), primary_key=True)
    permission_code: Mapped[str] = mapped_column(String(60), primary_key=True)
    granted: Mapped[bool] = mapped_column(Boolean)


class BusinessModule(Base):
    __tablename__ = "business_modules"

    business_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("businesses.id"), primary_key=True)
    module_code: Mapped[str] = mapped_column(String(40), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, server_default="true")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
