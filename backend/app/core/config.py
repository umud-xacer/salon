"""Sozlamalar — faqat muhit o'zgaruvchilari / .env orqali. Maxfiy qiymatlarning standart qiymati yo'q."""
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"

    # Ilova ikki xil baza roli bilan ulanadi (002_security.sql ga qarang)
    database_url: str                         # app_api — RLS ostida
    auth_database_url: str                    # app_auth — faqat kirish jadvallari
    migration_database_url: str | None = None # jadvallar egasi — faqat migratsiya va CLI

    worker_database_url: str | None = None    # app_worker — fon jarayoni, faqat eslatma funksiyalari

    jwt_secret: SecretStr = Field(min_length=32)
    jwt_issuer: str = "salon-platform"
    access_token_minutes: int = Field(default=15, ge=1, le=60)
    refresh_token_days: int = Field(default=30, ge=1, le=90)

    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5

    login_max_attempts: int = 5
    login_lock_minutes: int = 15

    cors_origins: list[str] = []
    sms_provider: Literal["console", "eskiz"] = "console"
    eskiz_email: str | None = None
    eskiz_password: SecretStr | None = None
    eskiz_from: str = "4546"
    # Eskiz'da moderatsiyadan o'tgan matnlarga aynan mos bo'lishi kerak
    sms_otp_template: str = "Tasdiqlash kodi: {code}"
    sms_reset_template: str = "Parolni tiklash kodi: {code}"

    # Bron eslatmasi: boshlanishidan necha daqiqa oldin yuboriladi va javob uchun necha daqiqa kutiladi
    reminder_lead_minutes: int = Field(default=30, ge=5, le=240)
    reminder_response_minutes: int = Field(default=15, ge=1, le=120)

    # Yandex HTTP Geocoder (manzil ↔ koordinata). Kalit faqat serverda — mobil ilovaga berilmaydi.
    # Xaritaning o'zi mobil ilovada Yandex MapKit (alohida, mobil kalit) bilan chiziladi.
    yandex_geocoder_api_key: SecretStr | None = None
    yandex_geocoder_lang: str = "ru_RU"

    @model_validator(mode="after")
    def _prod_checks(self):
        if self.env == "prod":
            if self.sms_provider == "console":
                raise ValueError("prod muhitida SMS_PROVIDER=console bo'lishi mumkin emas")
            if self.eskiz_email is None or self.eskiz_password is None:
                raise ValueError("prod muhitida ESKIZ_EMAIL va ESKIZ_PASSWORD kerak")
            if "*" in self.cors_origins:
                raise ValueError("prod muhitida CORS '*' taqiqlangan")
        return self

    @property
    def expose_dev_otp(self) -> bool:
        """Dev/test da OTP kodi javobda qaytariladi (SMS yuborilmaydi)."""
        return self.env != "prod" and self.sms_provider == "console"


@lru_cache
def get_settings() -> Settings:
    return Settings()
