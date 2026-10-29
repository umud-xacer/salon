# Arxitektura — xizmat ko'rsatish platformasi (MVP)

Salon, klinika, barbershop, spa va boshqa maskanlarni **topish, xaritada ko'rish va bron qilish** uchun
mobil ilova (iOS/Android) + veb-admin panel. Hozirgi SalonPro (FastAPI) shu platformaning asosi bo'ladi.

## 1. Umumiy ko'rinish

```
 ┌───────────────────────┐   ┌──────────────────────────────┐
 │  Mobil ilova (Expo)   │   │  Veb-admin (React + Vite)    │
 │  - Mijoz              │   │  - Super Admin               │
 │  - Xodim/sartarosh    │   │  - Salon egasi / menejer     │
 └──────────┬────────────┘   │  - Qabulxona                 │
            │  HTTPS + JWT   └──────────────┬───────────────┘
            └──────────────┬────────────────┘
                   ┌───────▼────────┐
                   │ FastAPI (REST) │──► Redis (OTP, kesh, navbat)
                   │  /api/v1/...   │──► Worker: SMS, push, eslatmalar
                   └───────┬────────┘
                   ┌───────▼─────────────┐   ┌───────────────────┐
                   │ PostgreSQL + PostGIS│   │ S3 (rasmlar)      │
                   └─────────────────────┘   └───────────────────┘
```

## 2. Texnologiyalar va nima uchun

| Qism | Tanlov | Sabab |
|---|---|---|
| Mobil | **React Native + Expo** (TypeScript) | Bitta kod → iOS + Android; EAS Build orqali Mac'siz iOS build; OTA yangilanishlar |
| Navigatsiya | Expo Router | Fayl asosidagi marshrutlar, deep link (`/b/demo-salon`) tayyor |
| Server ma'lumoti | TanStack Query | Kesh, qayta yuklash, offline holat |
| Xarita | `react-native-maps` (Google/Apple) | Expo bilan ishlaydi; kerak bo'lsa keyin Yandex SDK ga almashtirsa bo'ladi |
| Veb-admin | **React + Vite + Tailwind** | Jadval/formalarga boy panel, mobil bilan bir xil TS tipi va API client |
| Backend | **FastAPI** (mavjud kod) | 100+ endpoint tayyor, biznes mantig'i bor — noldan yozishdan tezroq |
| ORM / migratsiya | SQLAlchemy 2 + **Alembic** | Hozirgi qo'lda migratsiya muammosini yo'qotadi |
| Baza | **PostgreSQL 16+ + PostGIS** | "Yaqin atrofdagi salonlar" qidiruvi, bron to'qnashuvini baza darajasida taqiqlash |
| Kesh/navbat | Redis + ARQ (yoki Celery) | OTP, eslatma SMS/push, rate-limit |
| Kirish | Telefon + SMS OTP (mijoz), parol (admin), JWT access + refresh | O'zbekistonda telefon asosiy identifikator |
| To'lov | Click, Payme (keyin Uzum) | Mavjud billing kodi qayta ishlatiladi |
| Push | Expo Push → FCM/APNs | Bitta API ikkala platforma uchun |
| Fayllar | S3-mos saqlash (Cloudflare R2 / MinIO) | Rasmlar serverda emas |

> **Muqobil:** NestJS (Node) backend tanlansa butun loyiha TypeScript bo'ladi. Lekin mavjud FastAPI kodini
> tashlab yuborish 1–2 oy qo'shimcha ish. Tavsiya: FastAPI'da qolish, TS tiplarni OpenAPI'dan avtomatik generatsiya qilish.

## 3. Papkalar tuzilmasi (monorepo)

```
platforma/
├── apps/
│   ├── mobile/                      # Expo — mijoz + xodim ilovasi (rolga qarab ekranlar)
│   │   ├── app/                     # Expo Router ekranlari
│   │   │   ├── (auth)/              # telefon, OTP kod
│   │   │   ├── (client)/            # mijoz: xarita, qidiruv, salon sahifasi, bron, profil
│   │   │   │   ├── index.tsx        # bosh sahifa / yaqin atrofdagilar
│   │   │   │   ├── map.tsx
│   │   │   │   ├── business/[slug].tsx
│   │   │   │   ├── booking/[businessId].tsx   # xizmat → usta → vaqt → tasdiq
│   │   │   │   └── my-bookings.tsx
│   │   │   └── (staff)/             # xodim: bugungi jadval, bron tafsiloti
│   │   ├── src/
│   │   │   ├── components/          # UI komponentlar
│   │   │   ├── features/            # booking/, search/, auth/ — har birida hooks + api
│   │   │   ├── lib/                 # api client, storage, push
│   │   │   └── i18n/                # uz.json, ru.json
│   │   └── app.config.ts
│   │
│   └── admin/                       # React + Vite — veb panel
│       └── src/
│           ├── pages/
│           │   ├── superadmin/      # bizneslar, tariflar, modullar, statistika
│           │   └── business/        # dashboard, kalendar, xodimlar, xizmatlar,
│           │                        # mijozlar, ombor, to'lovlar, oylik, sozlamalar
│           ├── components/
│           ├── features/
│           └── lib/
│
├── backend/                         # FastAPI
│   ├── app/
│   │   ├── main.py
│   │   ├── core/                    # config (.env), security (JWT, parol), deps (joriy user, huquq tekshiruvi)
│   │   ├── db/                      # session, base
│   │   ├── models/                  # SQLAlchemy — har domen alohida faylda
│   │   ├── schemas/                 # Pydantic kirish/chiqish
│   │   ├── services/                # biznes mantig'i (bo'sh vaqt hisoblash, to'lov, oylik)
│   │   ├── api/v1/
│   │   │   ├── public/              # mijoz: qidiruv, salon, bo'sh vaqtlar, bron
│   │   │   ├── business/            # salon ichki boshqaruvi (business_id + huquq)
│   │   │   ├── staff/               # xodim: o'z jadvali
│   │   │   ├── superadmin/
│   │   │   └── webhooks/            # click, payme
│   │   └── workers/                 # SMS, push, eslatmalar
│   ├── alembic/                     # migratsiyalar
│   ├── tests/
│   └── pyproject.toml
│
├── packages/
│   └── api-client/                  # OpenAPI'dan generatsiya qilingan TS tiplar + fetch client
│
├── docs/                            # schema.sql, ARXITEKTURA.md
├── docker-compose.yml               # postgres+postgis, redis, backend
└── .github/workflows/               # testlar, lint
```

## 4. Muhim arxitektura qarorlari

1. **Bitta `users` jadvali, rol — `business_members` da.** Bitta odam bir salonda sartarosh, boshqasida mijoz
   bo'lishi mumkin. Super Admin — `users.is_superadmin` bayrog'i.
2. **Huquqlar = rol + istisnolar.** `role_permissions` standart huquqlarni beradi; salon egasi aniq xodimga
   `member_permissions` orqali qo'shimcha huquq beradi yoki olib qo'yadi. Backendda bitta funksiya:
   `require_permission("finance.view")`.
3. **Modullar.** Tarif (`plan_modules`) + Super Admin istisnolari (`business_modules`). Modul o'chiq bo'lsa,
   tegishli endpointlar 403 qaytaradi va ilova menyusida ko'rinmaydi.
4. **Multi-tenant:** har bir ichki jadvalda `business_id`; har bir so'rovda filtr majburiy (hozirgi 1.1 da
   tuzatilgan xato shu sabab paydo bo'lgan edi). Keyinroq PostgreSQL Row-Level Security bilan mustahkamlash mumkin.
5. **Ikki marta bron bo'lmaydi:** `appointments` dagi `EXCLUDE USING GIST` cheklovi bir ustaga ustma-ust vaqtni
   bazaning o'zida taqiqlaydi. Ikki mijoz bir vaqtda bosganda ham faqat bittasi o'tadi.
6. **Bo'sh vaqtlar** `staff_schedules` − `staff_time_off` − faol bronlar asosida serverda hisoblanadi
   (`GET /public/businesses/{id}/slots?service_id=&member_id=&date=`).
7. **Pul `BIGINT` (so'm), vaqt `TIMESTAMPTZ`.** Hozirgi kodda narx `float`, sana matn ko'rinishida saqlanadi —
   bu yaxlitlash va saralash xatolariga olib keladi.
8. **Hamma narsa ID orqali bog'lanadi.** Hozir usta bron va moliyaga **ism bo'yicha** (`ilike '%Dilnoza%'`)
   bog'langan — bir xil ismli ikki usta bo'lsa hisob buziladi. Yangi sxemada `member_id`.
9. **Ombor — harakatlar jurnali.** `stock_movements` har kirim/chiqimni yozadi; `products.current_qty` — kesh.
10. **Tarixiy narx saqlanadi:** `appointment_services.price` — bron paytidagi narx; xizmat narxi o'zgarsa eski
    hisobotlar buzilmaydi.

## 5. Hozirgi SalonPro'dan o'tish

| Hozir (SQLite) | Yangi |
|---|---|
| `salons` | `businesses` (+ `location`, `category_id`, `slug`) |
| `users` (role matn) | `users` + `business_members` |
| `staff` | `business_members` (+ `staff_schedules`) |
| `services`, `clients` | `services`, `business_clients` |
| `appointments` (sana/vaqt matn, usta ismi) | `appointments` (`starts_at/ends_at`, `member_id`) + `appointment_services` |
| `finance` (kirim+chiqim aralash) | `payments` + `expenses` |
| `inventory`, `master_inventory`, `inventory_logs` | `products` + `stock_movements` |
| `tariffs`, `transactions` | `plans`, `business_subscriptions`, `payments` |
| `notifications`, `activity_logs` | `notifications`, `audit_logs` |

Ma'lumotlarni ko'chirish uchun bir martalik skript yoziladi (`scripts/migrate_sqlite_to_pg.py`).
