# Play Console anketalari — Chronix uchun tayyor javoblar

Kod va server holatiga asoslangan (2026-11-16). Javoblar haqiqatga mos bo'lishi shart — ilova o'zgarsa, shu fayl ham yangilanadi.

## 1. App access (kirish)
- "All or some functionality is restricted" → ko'rsatma: `loyxalar/PLAY_TEST_LOGIN.md` (repo'da emas).
- Izoh: ilova mehmon rejimida ochiladi; bron, profil, sevimlilar uchun kirish kerak.

## 2. Ads
- **No**, ilovada reklama yo'q.

## 3. Content rating (IARC anketasi)
- Category: **Utility, Productivity, Communication or Other** (bron xizmati).
- Violence, sexual content, profanity, drugs, gambling: **No**.
- Users can interact or exchange content: **Yes** — foydalanuvchi salonga sharh va baho qoldiradi (moderatsiya: salon javob beradi, Super Admin o'chira oladi).
- Shares user's location with other users: **No**.
- Allows purchases of digital goods: **No** (to'lov salonda, ilovada emas).
- Kutilgan natija: **3+ / Everyone** (sharhlar sababli "Users Interact" belgisi bo'lishi mumkin).

## 4. Target audience
- Yosh guruhi: **18+** (yoki 16+ dan yuqori). Bolalarga mo'ljallanmagan. Privacy policy'da "16 yoshdan katta" deyilgan.

## 5. Data safety
**Data collected and shared**

| Ma'lumot turi | Yig'iladi | Uchinchi tomonga beriladi | Majburiymi | Maqsad |
|---|---|---|---|---|
| Personal info → Name | Ha | Ha (siz bron qilgan salon) | Majburiy (bron uchun) | App functionality, Account management |
| Personal info → Phone number | Ha | Ha (salon; SMS uchun Eskiz) | Majburiy | App functionality, Account management, Fraud prevention |
| Personal info → Email address | Ha (faqat Google bilan kirsa) | Yo'q | Ixtiyoriy | Account management |
| Personal info → Other (tug'ilgan sana, jins) | Ha | Yo'q | Ixtiyoriy | Personalization |
| Location → Approximate + Precise | Ha (faqat ilova ochiq paytda, ruxsat bilan) | Yo'q | Ixtiyoriy | App functionality (yaqin salonlar) |
| App activity → Other user-generated content (sharhlar) | Ha | Ha (ochiq ko'rinadi) | Ixtiyoriy | App functionality |
| App activity → In-app actions / Other (bronlar tarixi) | Ha | Ha (tegishli salon) | Majburiy | App functionality |
| Device or other IDs (push token) | Ha | Yo'q (Expo/FCM yetkazish uchun ishlov beruvchi) | Ixtiyoriy | App functionality (eslatmalar) |

- Is all user data encrypted in transit? **Yes** (HTTPS).
- Do you provide a way for users to request deletion? **Yes** — ilova ichida va https://chronix.uz/hisobni-ochirish
- Is data collection required or optional: yuqoridagi jadvalga qarang.
- Financial info, health, contacts, photos, audio, files, calendar, web history: **No**.
- Privacy policy URL: https://chronix.uz/privacy

## 6. Boshqa deklaratsiyalar
- Government app: No. Financial features: No. Health app: No (stomatologiya/LOR — faqat bron, tibbiy ma'lumot yo'q).
- News app: No. COVID: No.
- Account deletion URL: https://chronix.uz/hisobni-ochirish

## 7. Store listing
Matnlar va grafikalar: `docs/play-store/STORE_LISTING.md`, `icon-512.png`, `feature-graphic-1024x500.png`. Telefon skrinshotlari (2–8 ta, 1080×2400) hali olinmagan.
