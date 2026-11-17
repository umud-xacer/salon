# Play Console anketalari — Chronix uchun tayyor javoblar

Kod va server holatiga asoslangan (2026-11-16). Javoblar haqiqatga mos bo'lishi shart — ilova o'zgarsa, shu fayl ham yangilanadi.

## 0. Chiqarish tartibi (2026-11-17)
1. **Dasturchi hisobi** (play.google.com/console/signup): turini tanlash, 25 $ to'lov (karta — egasi o'zi kiritadi), shaxsni tasdiqlash (pasport/ID, 1–3 kun).
   - **Shaxsiy hisob** ("Для себя"): ochiq chiqarishdan oldin **yopiq test — kamida 12 sinovchi, 14 kun uzluksiz** (Google talabi).
   - **Tashkilot** ("Для организации"): yopiq test talabi yo'q, lekin **D-U-N-S raqami** kerak (bepul, 1–4 hafta).
2. **Ilova yaratish**: nomi "Chronix", til o'zbek (yoki rus), App, Free.
3. **App content** anketalari — quyidagi 1–6 bandlar.
4. **Store listing** — `STORE_LISTING.md`, `icon-512.png`, `feature-graphic-1024x500.png`, telefon skrinshotlari (2–8 ta).
5. **Testing → Internal testing**: .aab yuklash (EAS build, `uz.chronix.app`), o'zini sinovchi qilib qo'shish.
6. **App integrity → App signing**: SHA-1 ni olib, Google Cloud (loyiha `chronix-514914`) da 2-Android OAuth client "Chronix Play" yaratish — aks holda Play'dan o'rnatilgan ilovada Google bilan kirish ishlamaydi.
7. Shaxsiy hisob bo'lsa: **Closed testing** (12+ sinovchi, 14 kun) → **Production** ga ariza.

## 1. App access (kirish)
- "All or some functionality is restricted" → ko'rsatma: `loyxalar/PLAY_TEST_LOGIN.md` (repo'da emas).
- 2026-11-17 dan SMS orqali kirish o'chiq (`SMS_LOGIN_ENABLED=false`): tekshiruvchi **«Parol bilan kirish»** orqali kiradi (sinov raqami + parol). Telegram va Google ham bor.
- Izoh: ilova mehmon rejimida ochiladi; bron, profil, sevimlilar uchun kirish kerak.
- Ro'yxatdan o'tish: Telegram (raqam Telegram kontaktidan, tasdiqlangan) yoki Google (raqamni bir marta **Telegram bot orqali** tasdiqlaydi — @ChronixUzBot). Tasdiqlash kodlari ham botga keladi.

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
| Personal info → Phone number | Ha | Ha (salon; SMS yoqilsa — Eskiz; kod Telegram bot orqali yuboriladi) | Majburiy | App functionality, Account management, Fraud prevention |
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
