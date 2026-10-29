# Backend (FastAPI + PostgreSQL/PostGIS)

## Xavfsizlik qatlamlari

| Qatlam | Nima qiladi | Qayerda |
|---|---|---|
| 1. Token | JWT (HS256, 15 daq.), `iss`/`exp`/`type` tekshiruvi, `alg=none` rad etiladi. Refresh — tasodifiy, bazada faqat SHA-256 xeshi, har ishlatilganda almashadi; eski token qayta kelsa butun sessiya bekor | `app/core/security.py`, `app/services/auth_service.py` |
| 2. Foydalanuvchi | Har so'rovda bazadan tekshiriladi: bloklangan / "hamma joydan chiqqan" (`token_version`) bo'lsa token darhol yaroqsiz | `app/api/deps.py` |
| 3. Huquq (API) | `require_permission("staff.manage")` → bazadagi `app.has_perm()` | `app/api/deps.py` |
| 4. Huquq (baza) | Row-Level Security: har jadvalda siyosat. Ilova filtrni unutsa ham boshqa salon ma'lumoti ko'rinmaydi | `sql/002_security.sql` |
| 5. Soxtalashtirishga qarshi | Triggerlar: o'ziga huquq berish, Super Admin bo'lib olish, xodim narxni o'zgartirishi, qoldiqni qo'lda yozish — taqiqlangan | `sql/002_security.sql` |
| 6. Ma'lumot yaxlitligi | `EXCLUDE USING GIST` (ikki marta bron), kompozit FK (boshqa salonning ustasi/mijozi), CHECK (manfiy qoldiq, narx) | `sql/001_schema.sql` |
| 7. Kirish himoyasi | Parol: argon2id, 5 xato → 15 daq. blok. OTP: HMAC xesh, 5 urinish, bazada limit (raqamga 3/10 daq., IP ga 20/soat) | `auth_service.py`, `002_security.sql` |

Baza rollari: ilova **egasi bilan ulanmaydi**. `app_auth` — faqat kirish jadvallari, `app_api` — RLS ostida.

## Rollar

| Rol | Qanday paydo bo'ladi | Ilovada |
|---|---|---|
| Super Admin | faqat CLI: `python -m app.cli create-superadmin` | `workspace = "superadmin"` |
| Salon egasi | Super Admin biznes yaratganda | `workspace = "business"` |
| Menejer / Qabulxona / Xodim | Egasi qo'shadi (menejerni faqat egasi) | `workspace = "business"` |
| Mijoz | SMS kod bilan birinchi kirishda avtomatik | `workspace = "client"` |

Mobil ilova `GET /api/v1/auth/me` dagi `workspace` va `memberships[].permissions` ga qarab oynani ochadi.

## Ishga tushirish

```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
copy .env.example .env        # qiymatlarni to'ldiring
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m app.cli setup-roles
.venv\Scripts\python -m app.cli create-superadmin --phone +998901234567 --name "Ism"
.venv\Scripts\uvicorn app.main:app --reload
```
API hujjati: http://127.0.0.1:8000/docs

## Testlar

PostgreSQL 15+ va PostGIS kerak. Testlar `platform_test` bazasini har safar noldan yaratadi.
```powershell
$env:TEST_PG_ADMIN_URL = "postgresql+psycopg://postgres:PAROL@127.0.0.1:5432/postgres"
.venv\Scripts\python -m pytest
```
`tests/test_database_security.py` — ilovani chetlab, to'g'ridan-to'g'ri SQL bilan hujum qilib ko'radi.

## API (v1)

| Metod | Yo'l | Kim |
|---|---|---|
| POST | `/auth/otp/request`, `/auth/otp/verify` | hamma (ro'yxatdan o'tish ham shu) |
| POST | `/auth/login` | parolli foydalanuvchi (veb-admin) |
| POST | `/auth/refresh`, `/auth/logout` | refresh token egasi |
| POST | `/auth/logout-all`, `/auth/password` · GET `/auth/me` | kirgan foydalanuvchi |
| POST | `/superadmin/businesses` · PATCH `/superadmin/businesses/{id}/status` · PUT `/superadmin/businesses/{id}/modules/{code}` · PATCH `/superadmin/users/{id}/status` | Super Admin |
| GET/POST | `/businesses/{id}/members` · PATCH `/businesses/{id}/members/{mid}` · PUT `.../permissions/{code}` | `staff.manage` |
