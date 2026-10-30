from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.security import normalize_phone, validate_password_strength


class _Phone(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def _norm(cls, v: str) -> str:
        return normalize_phone(v)


# ─── Auth ───────────────────────────────────────────────────────────────────
class OtpRequest(_Phone):
    pass


class OtpRequestOut(BaseModel):
    sent: bool = True
    expires_in: int
    dev_code: str | None = None            # faqat dev/test muhitida


class OtpVerify(_Phone):
    code: str = Field(pattern=r"^\d{6}$")
    full_name: str | None = Field(default=None, max_length=120)


class PasswordForgot(_Phone):
    pass


class PasswordReset(_Phone):
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(max_length=128)

    @field_validator("new_password")
    @classmethod
    def _strong(cls, v: str) -> str:
        validate_password_strength(v)
        return v


class PasswordLogin(_Phone):
    password: str = Field(min_length=1, max_length=128)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=200)


class SetPasswordIn(BaseModel):
    old_password: str | None = Field(default=None, max_length=128)
    new_password: str = Field(max_length=128)

    @field_validator("new_password")
    @classmethod
    def _strong(cls, v: str) -> str:
        validate_password_strength(v)
        return v


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    phone: str
    full_name: str
    language: str
    is_superadmin: bool


class LoginOut(TokenOut):
    user: UserOut
    is_new: bool = False


class MembershipOut(BaseModel):
    member_id: int
    business_id: int
    business_name: str
    business_status: str
    role: str
    title: str | None
    permissions: list[str]


class MeOut(BaseModel):
    user: UserOut
    # Mobil ilova qaysi oynani ochishini shu maydon hal qiladi
    workspace: Literal["superadmin", "business", "client"]
    memberships: list[MembershipOut]


# ─── Super Admin ────────────────────────────────────────────────────────────
class BusinessCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=140)
    category_id: int = Field(ge=1)
    city: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=300)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    owner_phone: str
    owner_full_name: str = Field(min_length=2, max_length=120)
    modules: list[str] = ["booking"]

    @field_validator("owner_phone")
    @classmethod
    def _norm(cls, v: str) -> str:
        return normalize_phone(v)


class BusinessOut(BaseModel):
    id: int
    name: str
    slug: str
    status: str
    owner_member_id: int


class StatusIn(BaseModel):
    status: Literal["active", "blocked"]


class BusinessStatusIn(BaseModel):
    status: Literal["pending", "active", "blocked"]


class ModuleToggle(BaseModel):
    enabled: bool
    expires_at: datetime | None = None


# ─── Xodimlar ───────────────────────────────────────────────────────────────
class MemberCreate(_Phone):
    full_name: str = Field(min_length=2, max_length=120)
    role: Literal["manager", "receptionist", "staff"]     # 'owner' ni faqat Super Admin beradi
    title: str | None = Field(default=None, max_length=80)


class MemberUpdate(BaseModel):
    role: Literal["manager", "receptionist", "staff"] | None = None
    title: str | None = Field(default=None, max_length=80)
    is_active: bool | None = None
    is_bookable: bool | None = None


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    role: str
    title: str | None
    is_active: bool
    is_bookable: bool


class PermissionOverride(BaseModel):
    granted: bool | None                                  # None — istisnoni olib tashlash (rol standarti)
