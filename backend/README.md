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
| GET/POST | `/businesses/{id}/members` · PATCH `/businesses/{id}/members/{mid}` · PUT `.../permissions/{code}` · GET/PUT `.../services` | `staff.manage` |
| GET | `/catalog/categories` · `/catalog/businesses/nearby?lat&lng&radius_m&category&q&open_now` · `/catalog/businesses/in-bounds?sw_lat&sw_lng&ne_lat&ne_lng` · `/catalog/businesses/{slug}` | hamma (kirmasdan ham) |
| GET | `/geo/geocode?q=` · `/geo/reverse?lat&lng` (Yandex Geocoder) | kirgan foydalanuvchi |
| GET/PATCH | `/businesses/{id}/profile` · GET/PUT `/hours` · GET/POST/DELETE `/photos` | `business.manage` |
| GET/POST/PATCH/DELETE | `/businesses/{id}/service-categories` · `/businesses/{id}/services` | `services.manage` |
| GET | `/catalog/slots?member_id&service_id&date&step` | hamma (kirmasdan ham) |
| GET | `/businesses/{id}/slots?member_id&service_id&date&step` | `appointments.manage` |
| GET · PUT | `/businesses/{id}/members/{mid}/schedule` | GET: `staff.manage` yoki xodimning o'zi · PUT: `staff.manage` |
| GET/POST/DELETE | `/businesses/{id}/members/{mid}/time-off` | `staff.manage` yoki xodimning o'zi |
| POST | `/appointments` · GET `/appointments/mine?upcoming` | kirgan foydalanuvchi (mijoz) |
| GET | `/appointments/{id}` | bronni ko'ra oladigan har kim (RLS) |
| POST | `/appointments/{id}/cancel` · `/appointments/{id}/reschedule` | bron mijozi yoki `appointments.manage` |
| GET | `/businesses/{id}/appointments?date&member_id` | `view_all` / `view_own` (xodim faqat o'zinikini) |
| PATCH | `/businesses/{id}/appointments/{aid}/status` | salon; oddiy xodim faqat o'z broni: `in_progress`, `completed`, `no_show` |

### Bronlar
- Mijozda `appointments` ga yozish huquqi yo'q: bron faqat `app.book_appointment`, `app.cancel_appointment`, `app.reschedule_appointment` orqali.
- Mijoz, narx va davomiylik serverda aniqlanadi (tokendan va xizmatdan), so'rovdan olinmaydi.
- Ikki marta bron: oldin `app.compute_slots` tekshiradi, bir vaqtdagi so'rovlarni `no_double_booking` (EXCLUDE) rad etadi — `409 time_conflict`.
- Mijoz bitta salonda 5 tagacha faol bron qila oladi (`429`). Boshlangan bronni o'zgartirib bo'lmaydi (`409 not_changeable`).
- Mijoz ko'chirsa, bron qayta `pending` bo'ladi; salon ko'chirsa, holat saqlanadi.
- Begona bron uchun javob `404` — bron borligi ham oshkor bo'lmaydi.

### Bo'sh vaqtlar
- Hisob bazadagi `app.available_slots()` da: ish jadvali (kiritilmagan bo'lsa biznes soatlari), tanaffus, faol bronlar va ta'tillar hisobga olinadi.
- Tanaffus alohida saqlanmaydi: kun bir nechta ish oralig'i (`staff_schedules`), tanaffus ular orasidagi bo'shliq.
- Mijoz bron va ta'til jadvallarini o'qiy olmaydi (RLS) — funksiya faqat bo'sh vaqtni qaytaradi.
- Nomzodlar: `step` (5/10/15/20/30/60, standart 30) to'ri + band vaqt tugagan payt. Sana: bugundan 60 kungacha.

### Katalog xavfsizligi
- Katalog har doim **foydalanuvchisiz** RLS sessiyasida ishlaydi — Super Admin tokeni bilan ham yashirin/bloklangan biznes ko'rinmaydi.
- Ustalarning ism/lavozimi `public_staff` ko'rinishidan olinadi: telefon, maosh, `user_id` chiqmaydi.
- Qidiruv matnidagi `%`/`_` ekranlanadi; radius ≤ 50 km, xarita oynasi ≤ 1°, `limit` ≤ 100/300 — bazani to'liq yuklab olishga qarshi.
- Rasm havolalari faqat `https://` (API va bazada CHECK) — XSS'ga qarshi. Xizmat o'chirilmaydi, yashiriladi; narx o'zgarishlari `audit_logs` da (eski → yangi).

## Demo ma'lumotlar (dev)
```powershell
.venv\Scripts\python -m scripts.seed_demo     # Toshkentdagi 4 ta biznes, xizmatlar, ustalar
```
Super Admin: `+998900000001` / `SuperPass123`. Bizneslar egalari: `+99890100000{0..3}` (SMS kod dev rejimda javobda keladi).
