from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.security import normalize_phone, validate_password_strength
from app.services.uz_regions import REGION_NAMES


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


Gender = Literal["male", "female"]


def _past_date(value: date | None) -> date | None:
    if value is not None and not date(1900, 1, 1) <= value <= date.today():
        raise ValueError("Tug'ilgan sana noto'g'ri")
    return value


class OtpVerify(_Phone):
    """Yangi foydalanuvchi uchun qolgan maydonlar saqlanadi, mavjud hisob o'zgarmaydi."""
    code: str = Field(pattern=r"^\d{6}$")
    full_name: str | None = Field(default=None, max_length=120)
    birth_date: date | None = None
    gender: Gender | None = None
    password: str | None = Field(default=None, max_length=128)

    @field_validator("birth_date")
    @classmethod
    def _birth(cls, v: date | None) -> date | None:
        return _past_date(v)

    @field_validator("password")
    @classmethod
    def _password(cls, v: str | None) -> str | None:
        if v is not None:
            validate_password_strength(v)
        return v


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    birth_date: date | None = None
    gender: Gender | None = None
    language: Literal["uz", "ru", "en"] | None = None

    @field_validator("birth_date")
    @classmethod
    def _birth(cls, v: date | None) -> date | None:
        return _past_date(v)


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
    birth_date: date | None = None
    gender: str | None = None
    language: str
    is_superadmin: bool
    must_change_password: bool


class LoginOut(TokenOut):
    user: UserOut
    is_new: bool = False


class MembershipOut(BaseModel):
    member_id: int
    business_id: int
    business_name: str
    business_slug: str = ""                               # panel manzili: /barber-lab/kassa
    business_kind: str = "salon"                          # salon | pharmacy | clinic — panel yozuvlari
    staff_titles: list[str] = []                          # turga mos lavozim/mutaxassislik tavsiyalari
    business_type_name: str | None = None                 # "Stomatologiya", "Sartaroshxona" — panel bo'lim nomi
    business_type_name_ru: str | None = None              # ruscha panel uchun ("Стоматология")
    staff_word: str | None = None                         # turning xodim nomi ("Mutaxassis"), yo'q bo'lsa — standart
    business_status: str
    business_active: bool                                 # obuna bayrog'i
    subscription_ends_at: datetime | None                 # None = muddatsiz
    operational: bool                                     # False: salon to'xtatilgan, ma'lumot saqlanadi
    role: str
    panel: Literal["admin", "staff"]                      # egasi/menejer/kassir yoki usta
    title: str | None
    permissions: list[str]
    modules: list[str]


class MeOut(BaseModel):
    user: UserOut
    # Mobil ilova qaysi oynani ochishini shu maydon hal qiladi
    workspace: Literal["superadmin", "business", "client"]
    memberships: list[MembershipOut]


# ─── Super Admin ────────────────────────────────────────────────────────────
def _known_region(value: str | None) -> str | None:
    if value is not None and value not in REGION_NAMES:
        raise ValueError("Viloyat ro'yxatda yo'q")
    return value


RESERVED_SLUGS = {"superadmin", "b", "api", "assets", "media", "login", "admin", "panel", "health", "static"}


class BusinessCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=140)
    category_id: int = Field(ge=1)
    region: str | None = Field(default=None, max_length=80)
    city: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=300)
    # Lokatsiyasiz salon mijoz ilovasida ko'rinmaydi, shuning uchun yaratishda majburiy
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    owner_phone: str
    owner_full_name: str = Field(min_length=2, max_length=120)
    owner_password: str | None = Field(default=None, max_length=128)   # direktorning boshlang'ich paroli
    modules: list[str] = ["booking"]
    subscription_days: int | None = Field(default=None, ge=1, le=3660)    # None = muddatsiz
    plan_id: int | None = Field(default=None, ge=1)      # None = birinchi faol tarif (odatda Start)

    @field_validator("owner_phone")
    @classmethod
    def _norm(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("slug")
    @classmethod
    def _not_reserved(cls, v: str) -> str:
        # Havola panel manzili ham bo'ladi (www.chronix.uz/<havola>): tizim yo'llari bilan to'qnashmasin
        if v in RESERVED_SLUGS:
            raise ValueError("Bu havola band, boshqasini tanlang")
        return v

    @field_validator("owner_password")
    @classmethod
    def _strong(cls, v: str | None) -> str | None:
        if v:
            validate_password_strength(v)
        return v or None

    @field_validator("region")
    @classmethod
    def _region(cls, v: str | None) -> str | None:
        return _known_region(v)


class BusinessOut(BaseModel):
    id: int
    name: str
    slug: str
    status: str
    owner_member_id: int


class StatusIn(BaseModel):
    status: Literal["active", "blocked"]


class BusinessDeleteIn(BaseModel):
    confirm_name: str = Field(max_length=120)       # tasodifan o'chirmaslik uchun nomini qayta yozadi


class BusinessStatusIn(BaseModel):
    status: Literal["pending", "active", "blocked"]


class ModuleToggle(BaseModel):
    enabled: bool
    expires_at: datetime | None = None


class ModuleOut(BaseModel):
    code: str
    name: str


class BusinessUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    category_id: int | None = Field(default=None, ge=1)
    region: str | None = Field(default=None, max_length=80)
    city: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=300)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("region")
    @classmethod
    def _region(cls, v: str | None) -> str | None:
        return _known_region(v)

    @model_validator(mode="after")
    def _pair(self):
        if ("lat" in self.model_fields_set) != ("lng" in self.model_fields_set) or (self.lat is None) != (self.lng is None):
            raise ValueError("Lokatsiya uchun kenglik va uzunlik birga beriladi")
        return self


class BusinessAdminOut(BaseModel):
    id: int
    name: str
    slug: str
    category_id: int
    region: str | None
    city: str | None
    address: str | None
    lat: float | None
    lng: float | None
    status: str
    is_active: bool
    subscription_ends_at: datetime | None
    operational: bool
    monthly_fee: int = 0
    plan_id: int | None = None
    plan_name: str | None = None
    last_payment_at: datetime | None = None
    last_payment_amount: int | None = None
    last_payment_method: str | None = None
    paid_total: int = 0
    owner_name: str | None
    owner_phone: str | None
    owner_member_id: int | None = None
    owner_password_status: Literal["none", "issued", "temporary", "own"] | None
    owner_password_changed_at: datetime | None
    staff_count: int
    service_count: int = 0
    hours_count: int = 0
    photo_count: int = 0
    rating_avg: float = 0
    rating_count: int = 0
    owner_user_id: int | None = None
    owner_status: str | None = None                       # active | blocked
    owner_last_login_at: datetime | None = None
    type_name: str | None = None
    modules: list[str]


class SubscriptionRenew(BaseModel):
    days: int = Field(ge=1, le=3660)
    amount: int = Field(default=0, ge=0, le=10**12)                # so'm; 0 = pul olinmadi
    method: Literal["cash", "card", "transfer", "free"] = "cash"
    note: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _free_has_no_amount(self):
        if self.method == "free" and self.amount:
            raise ValueError("Bepul uzaytirishda summa bo'lmaydi")
        return self


class SubscriptionPaymentOut(BaseModel):
    id: int
    business_id: int | None
    business_name: str
    days: int
    amount: int
    method: str
    note: str | None
    ends_at: datetime
    created_by_name: str | None
    created_at: datetime


class UserMembershipBrief(BaseModel):
    business_id: int
    business_name: str
    role: str


class UserAdminOut(BaseModel):
    id: int
    phone: str
    full_name: str
    status: str
    is_superadmin: bool
    created_at: datetime
    last_login_at: datetime | None
    memberships: list[UserMembershipBrief]
    client_of: int                                              # nechta muassasada mijoz kartasi bor


class UserAdminPage(BaseModel):
    total: int
    items: list[UserAdminOut]


class AuditOut(BaseModel):
    id: int
    business_id: int | None
    business_name: str | None
    user_id: int | None
    user_name: str | None
    user_phone: str | None
    action: str
    entity_type: str
    entity_id: int | None
    changes: dict | list | None
    created_at: datetime


class BusinessExpiry(BaseModel):
    id: int
    name: str
    subscription_ends_at: datetime
    owner_phone: str | None


class CountRow(BaseModel):
    key: str
    label: str
    count: int
    label_ru: str | None = None          # ruscha panel uchun (muassasa turi)


class DailyPoint(BaseModel):
    day: date
    bookings: int
    new_clients: int


class MonthlyRevenue(BaseModel):
    month: str                                                  # 'YYYY-MM'
    amount: int
    count: int


class RatingRow(BaseModel):
    id: int
    name: str
    category: str
    category_ru: str | None = None
    rating_avg: float
    rating_count: int


class PlatformStats(BaseModel):
    businesses_total: int
    businesses_operational: int
    businesses_suspended: int
    businesses_blocked: int
    businesses_listed: int                                      # ilovada ko'rinadi
    expiring_soon: list[BusinessExpiry]
    by_type: list[CountRow]
    users_total: int
    clients_total: int                                          # hech qayerda xodim emas
    staff_total: int
    bookings_today: int
    bookings_30d: int
    bookings_30d_prev: int
    daily: list[DailyPoint]
    revenue_this_month: int
    revenue_prev_month: int
    revenue_monthly: list[MonthlyRevenue]
    recent_payments: list[SubscriptionPaymentOut]
    reviews_total: int = 0
    reviews_30d: int = 0
    rating_avg: float | None = None                             # barcha (yashirilmagan) baholar o'rtachasi
    rating_top: list[RatingRow] = []
    rating_low: list[RatingRow] = []


class SubscriptionUpdate(BaseModel):
    is_active: bool | None = None
    subscription_ends_at: datetime | None = None          # maydon yuborilib null bo'lsa: muddatsiz
    monthly_fee: int | None = Field(default=None, ge=0, le=100_000_000)   # so'm/oy; berilsa — maxsus narx (tarifsiz)
    plan_id: int | None = Field(default=None, ge=1)       # tarif tanlansa, narx tarifdan olinadi


# ─── Xodimlar ───────────────────────────────────────────────────────────────
class MemberCreate(_Phone):
    full_name: str = Field(min_length=2, max_length=120)
    role: Literal["manager", "receptionist", "staff"]     # 'owner' ni faqat Super Admin beradi
    title: str | None = Field(default=None, max_length=80)
    password: str | None = Field(default=None, max_length=128)    # boshlang'ich (vaqtinchalik) parol

    @field_validator("password")
    @classmethod
    def _strong(cls, v: str | None) -> str | None:
        if v:
            validate_password_strength(v)
        return v or None


class MemberUpdate(BaseModel):
    role: Literal["manager", "receptionist", "staff"] | None = None
    title: str | None = Field(default=None, max_length=80)
    is_active: bool | None = None
    is_bookable: bool | None = None


class MemberOut(BaseModel):
    id: int
    user_id: int
    role: str
    full_name: str
    phone: str
    title: str | None
    is_active: bool
    is_bookable: bool
    password_block: str | None                            # None: joriy foydalanuvchi parolni o'rnata oladi
    password_status: Literal["none", "issued", "temporary", "own"]  # parolning o'zi hech kimga ko'rinmaydi
    password_changed_at: datetime | None


class IssuedPasswordOut(BaseModel):
    """Rahbar bergan parol: odam o'z parolini qo'ymaguncha ko'rinadi, keyin None."""
    password: str | None
    status: Literal["none", "issued", "temporary", "own"]
    changed_at: datetime | None


class PhoneMembership(BaseModel):
    business_id: int
    business_name: str
    role: str


class PhoneLookupOut(BaseModel):
    phone: str
    exists: bool
    full_name: str | None = None
    memberships: list[PhoneMembership] = []


class OwnerChange(_Phone):
    """Super Admin: muassasa direktorini almashtirish (yoki shu odamning ismini tuzatish)."""
    full_name: str = Field(min_length=2, max_length=120)
    password: str | None = Field(default=None, max_length=128)        # yangi direktorning boshlang'ich paroli
    previous: Literal["manager", "remove"] = "manager"                 # eski direktor: menejer bo'lib qoladi / chiqariladi

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("password")
    @classmethod
    def _strong(cls, v: str | None) -> str | None:
        if v:
            validate_password_strength(v)
        return v or None


class MemberPasswordIn(BaseModel):
    new_password: str = Field(max_length=128)

    @field_validator("new_password")
    @classmethod
    def _strong(cls, v: str) -> str:
        validate_password_strength(v)
        return v


class MemberPermissionOut(BaseModel):
    code: str
    description: str | None
    module_code: str | None
    module_enabled: bool
    role_default: bool                                    # rol bo'yicha beriladimi
    override: bool | None                                 # None: shaxsiy istisno yo'q
    effective: bool                                       # hozir amalda bormi


class PermissionOverride(BaseModel):
    granted: bool | None                                  # None — istisnoni olib tashlash (rol standarti)
