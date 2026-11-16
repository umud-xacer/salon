# Chronix — Google Play'ga chiqarish

Ilova: **Chronix** · paket: `uz.chronix.app` · versiya 1.0.1 · Expo SDK 58.

## 1. Production build (.aab)

- `eas.json` → `production` profili: Android uchun standart format **App Bundle (.aab)**, `autoIncrement` (versionCode serverda o'zi oshadi), kanal `production`, API `https://api.chronix.uz`.
- Buyruq: `cd mobile && npx eas-cli build --platform android --profile production`.
- Imzo kaliti: EAS birinchi build'da Android keystore yaratadi va saqlaydi. Play Console'da **Play App Signing** yoqiladi (standart), shuning uchun EAS kaliti "upload key" bo'ladi.
- Yuklash: `npx eas-cli submit --platform android --profile production` (Google Play service account JSON kerak) yoki .aab ni Play Console'ga qo'lda yuklash.
- Production kanaliga OTA: `npx eas-cli update --channel production --environment production`. Hozirgi APK foydalanuvchilari `preview` kanalida qoladi.

### Android ruxsatlari (app.json)
| Ruxsat | Nima uchun |
|---|---|
| ACCESS_FINE/COARSE_LOCATION | Yaqin atrofdagi salonlar va xarita |
| VIBRATE, bildirishnomalar | Bron eslatmalari |
| USE_BIOMETRIC | Face ID / barmoq izi bilan kirish (ixtiyoriy) |
| INTERNET | Server bilan aloqa |

Olib tashlangan (`blockedPermissions`): RECORD_AUDIO, FOREGROUND_SERVICE(_MEDIA_PLAYBACK), ACCESS_NOTIFICATION_POLICY, SYSTEM_ALERT_WINDOW, READ/WRITE_EXTERNAL_STORAGE. Ilova ularni ishlatmaydi. Qoldirilganda Play alohida deklaratsiya va video talab qilardi.

## 2. Grafika

| Element | Talab | Fayl |
|---|---|---|
| Ilova ikonkasi | 512×512 PNG, 32-bit, ≤1 MB | `docs/play-store/icon-512.png` ✅ |
| Feature graphic | 1024×500 JPG/PNG, shaffofliksiz | `docs/play-store/feature-graphic-1024x500.png` ✅ |
| Telefon skrinshotlari | 2–8 ta, 16:9 yoki 9:16, har tomoni 320–3840 px; tavsiya: 1080×1920 (yoki 1080×2400) | telefondan olinadi ⬜ |
| Planshet skrinshotlari | Ixtiyoriy (planshet qo'llab-quvvatlanmaydi) | — |

Ilovadagi ikonka (`assets/icon.png` 1024, adaptive foreground/background/monochrome 1024) va splash (`#010D49` fonda logotip) sozlangan.

**Skrinshotlar tartibi** (telefonda, kunduzgi mavzu, 1080×2400):
1. Bosh sahifa — "Tavsiya etilganlar"
2. Qidiruv — xarita va salonlar ro'yxati
3. Salon sahifasi — rasm, reyting, "Bugungi chegirmalar"
4. Xizmatlar va ustalar
5. Bron: vaqt tanlash
6. Bronlarim
7. Sharhlar
8. Profil → Bonuslarim

Ixtiyoriy: har skrinshot ustiga 1 qatorli sarlavha ("Yaqin salonni xaritada toping" kabi).

## 3. Matnlar

### O'zbekcha (asosiy til: uz)
**Nom (≤30):** Chronix — onlayn bron

**Qisqa tavsif (≤80):** Salon, barber, stomatologiya va SPA'ga onlayn bron — tez va qulay

**To'liq tavsif (≤4000):**
```
Chronix — go'zallik saloni, barbershop, stomatologiya va SPA markazlariga navbatsiz, bir necha soniyada yozilish uchun ilova.

Qanday ishlaydi:
• Yaqin atrofdagi muassasalarni xaritada yoki ro'yxatda toping
• Reyting, haqiqiy mijozlar sharhlari, narxlar va ish vaqtini ko'ring
• Xizmatni, ustani va o'zingizga qulay vaqtni tanlang — bron darhol tasdiqlanadi
• Usta muhim emasmi? "Farqi yo'q" ni tanlang — eng yaqin bo'sh vaqt topiladi

Imkoniyatlar:
• Bugungi chegirmalar — bo'sh qolgan vaqtlarga arzonroq narx
• Promokodlar va tashriflar seriyasi: muntazam mijozlarga avtomatik chegirma
• Bron eslatmalari — tashrifni unutmaysiz
• Bronni bekor qilish yoki boshqa vaqtga ko'chirish
• Tashrifdan keyin baho va sharh qoldirish
• Sevimli salonlar, yaqinda ko'rilganlar
• SMS kod bilan tez ro'yxatdan o'tish, Face ID / barmoq izi bilan kirish
• Kunduzgi va tungi mavzu, o'zbek va rus tillari

Chronix — vaqtingiz bizning ustuvorligimiz.
```

### Русский (ru-RU)
**Название (≤30):** Chronix — онлайн-запись

**Краткое описание (≤80):** Онлайн-запись в салоны, барбершопы, стоматологии и SPA за секунды

**Полное описание:**
```
Chronix — приложение для записи в салоны красоты, барбершопы, стоматологии и SPA без очередей и звонков.

Как это работает:
• Найдите заведения рядом на карте или в списке
• Смотрите рейтинг, отзывы реальных клиентов, цены и часы работы
• Выберите услугу, мастера и удобное время — запись подтверждается сразу
• Не важно, какой мастер? Выберите «Любой» — найдём ближайшее свободное время

Возможности:
• Скидки сегодня — свободные окна дешевле
• Промокоды и серия визитов: постоянным клиентам скидка автоматически
• Напоминания о записи
• Отмена и перенос записи
• Оценка и отзыв после визита
• Избранные заведения, недавно просмотренные
• Быстрая регистрация по SMS-коду, вход по Face ID / отпечатку
• Светлая и тёмная тема, узбекский и русский языки

Chronix — ваше время в приоритете.
```

**Kategoriya:** Lifestyle (yoki Beauty) · **Teglar:** Beauty, Booking.
**Aloqa:** email (majburiy), sayt `https://chronix.uz`.

## 4. Play Console talablari — holat

| Talab | Holat |
|---|---|
| Maxfiylik siyosati (privacy policy) URL | ⬜ **Yo'q** — `chronix.uz/privacy` sahifasi kerak |
| Hisobni o'chirish (ilova ichida + veb havola) | ⬜ **Yo'q** — Play 2024-yildan majburiy |
| Data safety formasi | ⬜ Tayyorlash: telefon raqami, ism, taxminiy/aniq joylashuv, bronlar tarixi, qurilma push tokeni; shifrlangan uzatish (HTTPS); o'chirish so'rovi mumkin |
| Ko'rib chiquvchi uchun kirish (App access) | ⬜ SMS kod orqali kirish — Google tekshiruvchisiga **doimiy sinov raqami + kod** kerak (Eskiz hozir test rejimida) |
| Kontent reytingi anketasi | ⬜ Play Console'da to'ldiriladi (zo'ravonliksiz, "Everyone") |
| Maqsadli auditoriya | ⬜ 18+ (yoki 13+), bolalarga mo'ljallanmagan |
| Reklama bormi | Yo'q |
| Yangi shaxsiy dasturchi hisobi | Agar hisob 2023-11-dan keyin ochilgan shaxsiy hisob bo'lsa: **12 sinovchi × 14 kun yopiq test** talab qilinadi |
