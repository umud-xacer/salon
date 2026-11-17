# Fresha partner paneli — tugmama-tugma tahlil va Chronix bilan solishtirish

**Sana:** 2026-11-17 (birinchi, menyu darajasidagi ko'rib chiqish: 2026-11-16).
**Usul:** foydalanuvchining Fresha hisobida ("arbalet") Chrome orqali har bir bo'lim, tugma, ochiladigan menyu va forma ochib ko'rildi. Hech narsa saqlanmadi: formalar "Закрыть", savdo oynasi "Не сохранять" bilan yopildi. To'lov, o'chirish va yuborish tugmalari bosilmadi.
**Solishtirish:** Chronix kodi (`backend/sql/*.sql`, `backend/app/api/v1/*`, `web/src/modules/*`) bo'yicha.

Belgilar: ✅ bor · 🟡 qisman bor · ❌ yo'q

---

## 1. Kalendar

| Fresha imkoniyati | Chronix | Izoh |
|---|---|---|
| Kun / hafta ko'rinishi | ✅ | `CalendarPage` — `day`, `week` |
| 3 kun, oy, vaqt shkalasi, kun tartibi (agenda), ustun ko'rinishlari | ❌ | Fresha'da 7 xil ko'rinish |
| "Smenadagi jamoa" filtri | 🟡 | usta bo'yicha filtr bor |
| Ko'rinish filtrlari: holat, tur, kanal, to'lov holati, xizmat, yaratilgan sana, "mijoz so'ragan usta", mijoz guruhi + **saqlangan filtrlar** | 🟡 | Chronix'da faqat usta filtri |
| Kalendar sozlamalari: bron ustiga olib borganda ko'rinadigan ma'lumot, katakni bosib tez qo'shish, bekor qilinganlarni ko'rsatish | 🟡 | katakni bosib bron bor, qolgani yo'q |
| "Qo'shish" menyusi: bron, **guruh broni**, **bloklangan vaqt**, savdo, tez to'lov | 🟡 | bron va walk-in bor; guruh broni va kalendarda vaqtni bloklash yo'q (faqat xodim ta'tili `staff_time_off`) |
| "Bo'sh vaqtni ko'rish" — xizmat tanlansa bo'sh slotlar ro'yxati | ✅ | `reception/slots` |
| Mijozsiz bron ("Без записи" / walk-in) | ✅ | `WalkInDialog` |
| Bitta bronda bir nechta xizmat | ✅ | `appointment_services`, `visit_lines` |
| Bron qatorida: narxni o'zgartirish, **qatorga chegirma**, davomiylikni o'zgartirish | 🟡 | visit_lines'da narx bor; qatorga chegirma yo'q |
| ♡ "Mijoz aynan shu ustani so'radi" belgisi | ❌ | hisobotlar va qayta taqsimlashda ishlatiladi |
| **Qo'shimcha vaqt**: kutish vaqti (bo'yoq, usta bo'sh), bloklangan vaqt (tozalash), qo'shimcha xizmat vaqti | ❌ | `services`da buffer yoki processing ustuni yo'q |
| **Takrorlanadigan bron** ("Не повторяется" → har hafta va h.k.) | ❌ | |
| Bron holatlari: band qilingan, tasdiqlangan, **mijoz keldi**, boshlandi, bajarildi, bekor qilindi, kelmadi | 🟡 | Chronix: pending, confirmed, in_progress, completed, cancelled, no_show — "mijoz keldi" holati yo'q |
| **O'z holatlarini yaratish** (Sozlamalar → Статусы визитов) | ❌ | |
| Bron menyusi: eslatma, **anketa qo'shish**, **bron tarixini ko'rish**, takrorlashni yoqish, guruhga qo'shish, **qayta bron qilish**, ko'chirish, kelmadi, bekor qilish | 🟡 | eslatma, ko'chirish, holat, bekor qilish bor; anketa, bron tarixi (audit faqat super admin'da), takrorlash, "qayta bron" yo'q |
| Bronga **to'lov siyosati** (depozit yoki karta bilan kafolat) | ❌ | Fresha'da O'zbekiston uchun "Скоро" |
| **Kutish ro'yxati** (ochiq / muddati o'tgan / bron qilingan), avtomatik bron, "birinchi navbatdagi" ustuvorligi, onlayn kutish ro'yxati | ❌ | |

## 2. Savdo va kassa

| Fresha imkoniyati | Chronix | Izoh |
|---|---|---|
| Kunlik savdo hisoboti: tur bo'yicha (xizmat, qo'shimcha, tovar, sertifikat) va to'lov usuli bo'yicha pul oqimi, eksport | ✅ | `finance/cash/day` + Excel |
| **Kassa smenasi**: kunni ochish va yopish, kassaga kirim va chiqim, mayda xarajatlar, qoldiq | 🟡 | xarajatlar bor; smena ochish, yopish va qoldiq yo'q |
| Bronlar ro'yxati: qidiruv, filtr, eksport | 🟡 | ro'yxat bor, alohida eksport yo'q |
| Savdolar ro'yxati + **qoralamalar** | ❌ | |
| Savdo savatchasi: bron, xizmat, tovar, paket, sertifikat; **tez savdo** (sevimli tugmalar) | 🟡 | chek va tovar sotish bor; paket va sertifikat yo'q |
| **Choychaqa (tips)**: 10/18/25% yoki boshqa summa, ustaga tushadi | ❌ | |
| Savatchaga chegirma, chekka izoh, **xizmat yig'imi** | 🟡 | promokod va aksiya bor; xizmat yig'imi va chek izohi yo'q |
| "Qoralama sifatida saqlash", "To'lanmagan deb saqlash" | ❌ | |
| To'lov usullari: naqd, **sertifikat bilan**, **bo'lib to'lash (split)**, boshqa (o'z usullari) | 🟡 | naqd, karta, Click, Payme, Uzum, bonus bor; split va o'z usullari yo'q |
| Pulni qaytarish | ✅ | `refund_payment` |
| Sotilgan sertifikatlar, paketlar, abonementlar | ❌ | |

## 3. Mijozlar

| Fresha imkoniyati | Chronix | Izoh |
|---|---|---|
| Mijozlar ro'yxati, qidiruv, filtr, saralash | ✅ | |
| **Mijozlarni import qilish**, **dublikatlarni birlashtirish**, Excel/CSV eksport | ❌ | |
| Mijoz kartochkasi: umumiy ma'lumot, bronlar, savdolar, **hamyon (balans)**, sodiqlik, sharhlar | 🟡 | bronlar, tashriflar soni, jami summa, bonus balansi bor |
| Kartochkada: **eslatmalar (bir nechta)**, **allergiyalar**, **patch-testlar**, **anketalar**, **fayllar** | 🟡 | faqat bitta `notes` maydoni |
| Mijoz ma'lumotlari: tug'ilgan kun, jins, manba ("qayerdan keldi"), kim tavsiya qildi, til, kasb, qo'shimcha telefon, **teglar**, manzillar, **favqulodda kontaktlar**, xabar va marketing roziligi | ❌ | `business_clients` da faqat ism, telefon, notes (tug'ilgan kun va jins faqat ilova foydalanuvchisi profilida) |
| Mijoz amallari: chat xabari, **jamoa uchun ogohlantirish (flag)**, allergiya, patch-test, anketa, teg | ❌ | |
| **Mijoz guruhlari (segmentlar)**: tayyor 7 tasi (yangi, yaqinda kelgan, birinchi tashrif, sodiq, faol emas, foydali, tug'ilgan kuni yaqin) + **qoida bilan o'z guruhini yaratish** (bronlar soni, summa, tug'ilgan kun, yosh, jins, manba, teg, bonus...) | ❌ | marketing, hisobot va kalendarda ishlatiladi |
| Sodiqlik: ballar, darajalar, **referal** (oyiga 255 000 so'm, pullik) | 🟡 | Chronix: tashriflar seriyasi (5 tashrif → 20%) |
| Onlayn obro': Fresha + **Google sharhlari bitta joyda**, **AI bilan javob**, javob berish foizi | 🟡 | sharhlar va javob bor; Google ulanishi, AI va javob foizi yo'q |

## 4. Katalog va ombor

| Fresha imkoniyati | Chronix | Izoh |
|---|---|---|
| Xizmatlar menyusi, bo'limlar, tartibni o'zgartirish | ✅ | |
| **Xizmatlar to'plami (набор)** — bir nechta xizmat bitta mahsulot sifatida | ❌ | |
| Xizmat formasi: **narx turi (bepul / "...dan" / aniq)**, **variantlar** (masalan sochi uzunligi bo'yicha narx) | ❌ | faqat bitta aniq narx |
| Xizmat tavsifi, **AI bilan yozish** | 🟡 | tavsif bor, AI yo'q |
| Xizmatga ustalarni biriktirish | ✅ | `member_services` |
| Xizmatga **resurslar** (xona, kreslo, apparat) | ❌ | |
| **Xizmatga qo'shimchalar** (add-on guruhlari, mijoz bron paytida tanlaydi) | ❌ | |
| Xizmat bo'yicha onlayn bron yoqish/o'chirish, "faqat ayollar/erkaklar uchun" | 🟡 | `is_active` bor, jins bo'yicha cheklov yo'q |
| **Xizmat portfoliosi (rasmlar)** | ❌ | salon rasmlari bor, xizmatniki yo'q |
| Xizmatga anketa biriktirish | ❌ | |
| Xizmat bo'yicha komissiya | 🟡 | usta bo'yicha foiz bor, xizmat bo'yicha yo'q |
| **Patch-test talab qilish** | ❌ | |
| **Muolajadan keyingi parvarish bo'yicha tavsiyalar** (mijozga xabar) | ❌ | |
| **"N haftadan keyin qayta yoziling" eslatmasi** (xizmat bo'yicha) | ❌ | |
| Soliq, **xizmat tannarxi** (summa yoki %), SKU | ❌ | |
| Paketlar | ❌ | |
| Tovarlar, ombor, shtrix-kod, minimal qoldiq | ✅ | `products.min_qty`, skaner |
| Inventarizatsiya (pauza qilib davom ettirish) | 🟡 | tuzatish (`adjustment`) bor, inventarizatsiya jarayoni yo'q |
| **Ta'minotchiga buyurtma** va **ta'minotchilar** ro'yxati | ❌ | `purchase` harakati bor, buyurtma va ta'minotchi yo'q |

## 5. Onlayn bron

| Fresha imkoniyati | Chronix | Izoh |
|---|---|---|
| Marketplace profili | ✅ | chronix.uz + ilova |
| **Google orqali bron** (Qidiruv va Xaritalar) | ❌ | |
| **Facebook/Instagram bron tugmasi** | ❌ | |
| **To'g'ridan-to'g'ri havolalar va QR**: umumiy havola, faqat bron havolasi, **o'z havolasi** (tanlangan xizmatlar) | 🟡 | `chronix.uz/s/<slug>` bor; QR va maxsus havolalar yo'q |
| "Aqlli sayt" (o'z domeni bilan, oyiga 120 000 so'm) | ❌ | |
| Bron oynasi (qachondan qachongacha bron mumkin), bekor qilish/ko'chirish muddati | 🟡 | 040 migratsiyada qisman |
| **Slot qadami** (15 daqiqa) va **bo'shliqlarni kamaytirish** (faqat oraliqsiz vaqtlarni taklif qilish) | ❌ | |
| **Dinamik taqsimlash**: "eng bo'sh usta"ga berish, ko'p xizmatli bronni turli ustalarga bo'lish, "usta tanlanmagan" bronni ustani tanlagan mijoz foydasiga qayta taqsimlash | 🟡 | usta avtomatik tanlanadi; bo'lish va qayta taqsimlash yo'q |
| Mijozga ko'rinadigan narsalar: usta profili, portfoliosi, **usta reytingi**, usta jinsi bo'yicha tanlash | 🟡 | ustalar ko'rinadi; portfolio va usta reytingi yo'q |
| **Guruh broni** (bir nechta odam uchun) | ❌ | |
| **Qo'shimcha sotuv** (bron paytida qo'shimcha xizmat yoki paket taklifi) | ❌ | |
| Bron oldidan ko'rsatiladigan "muhim ma'lumot" | ❌ | |
| Onlayn bron bo'yicha xodimlarga email | 🟡 | push va Telegram bor |

## 6. Marketing

| Fresha imkoniyati | Chronix | Izoh |
|---|---|---|
| **Ommaviy kampaniyalar** (SMS/email): hammaga, guruhga yoki bitta mijozga, hisobot bilan | ❌ | |
| Avtomatik eslatmalar: **3 kun / 24 soat / 1 soat** oldin | 🟡 | eslatma bor (push + budilnik), muddatlarni salon sozlamaydi |
| Bron xabarlari: yangi bron, ko'chirildi, bekor qilindi, **kelmadi**, **"tashrif uchun rahmat" + sharh so'rash** | 🟡 | yangi, ko'chirildi va bekor qilindi push bor; "kelmadi" va sharh so'rash yo'q |
| Kutish ro'yxati xabarlari (qo'shildingiz, vaqt bo'shadi) | ❌ | |
| **Qayta bron eslatmasi**, **tug'ilgan kun tabrigi**, **yo'qolgan mijozni qaytarish**, **sodiq mijozni rag'batlantirish**, **yangi mijozni chegirma bilan kutib olish** | ❌ | |
| Sodiqlik xabarlari (ballar, daraja, mukofot, referal) | ❌ | |
| Yuborilgan xabarlar tarixi | ❌ | |
| **Xabar balansi** (SMS uchun hisob, avtomatik to'ldirish) | ❌ | Eskiz hisobi salon bo'yicha emas |
| Aksiyalar: promokod, **flesh-savdo**, oxirgi daqiqa takliflari | ✅ | promokod + Hot Slots |
| **"Aqlli narx"**: band soatlarda narxni oshirish, bo'sh soatlarda pasaytirish | 🟡 | Hot Slots faqat chegirma beradi, band soatlarda narx oshmaydi |

## 7. Jamoa

| Fresha imkoniyati | Chronix | Izoh |
|---|---|---|
| Xodimlar ro'yxati, rollar | ✅ | owner, manager, receptionist, staff + `member_permissions` |
| **Xodim natijalari paneli**: savdo, bronlar, mijozlar, **bandlik %**, **mijozni ushlab qolish %** | 🟡 | hisobotda usta bo'yicha bronlar va tushum bor; bandlik va ushlab qolish yo'q |
| Xodim ma'lumotlari: kalendardagi rang, lavozim, ish turi, xodim ID | 🟡 | |
| **Tashqi kalendarga ulash** (Google Calendar) | ❌ | |
| Smenalar jadvali (haftalik) | ✅ | `ScheduleEditor` |
| Ta'tillar, **dam olish turlari** | 🟡 | ta'til bor, turlari yo'q |
| **Tabel (kelib-ketish, tanaffuslar)** va davomat | ❌ | |
| Oylik hisoblash (pay runs), komissiya, avans | ✅ | `payroll`, avanslar |
| **PIN-kod bilan kirish** (umumiy planshetda) | ❌ | |
| **Rollar ruxsatlarini o'zi sozlash** (Базовый/Низкий/Средний/Высокий, bo'limma-bo'lim) | 🟡 | `member_permissions` bor, rollar tayyor |

## 8. Hisobotlar (Fresha'da 64 ta)

| Fresha imkoniyati | Chronix | Izoh |
|---|---|---|
| Asosiy: tushum, foyda, xarajat, to'lov usullari, bronlar holati, xizmatlar, bo'limlar, ustalar, yangi/qaytgan mijozlar, Excel | ✅ | `ReportsPage` + `export.xlsx` |
| **Savdo jurnali** (har bir tranzaksiya), davr bo'yicha savdo | 🟡 | |
| Soliq, **pul oqimi**, **majburiyatlar** (sertifikat va oldindan to'lov qoldig'i) | ❌ | |
| **Chegirmalar hisoboti** | ❌ | |
| **Bekor qilingan va kelmaganlar tahlili**, sabablari bilan | 🟡 | foiz bor, **bekor qilish sabablari** ro'yxati yo'q |
| Kutish ro'yxati hisobotlari | ❌ | |
| Ish vaqti, tanaffus, davomat, smenalar | ❌ | |
| Oylik, komissiya, ushlanmalar | 🟡 | oylik sahifasi bor |
| **Choychaqa hisobotlari** | ❌ | |
| Ombor: qoldiq, harakatlar jurnali, buyurtmalar | 🟡 | qoldiq va harakatlar bor |
| Mijozlar: qayta bron qilish, faollik | 🟡 | |
| **Sevimlilar, papkalar, o'z hisobotini yaratish**, **ma'lumot ulagichi** (Google Sheets va boshqalar) | ❌ | |
| AI Concierge, aqlli sayt, onlayn bron panellari | ❌ | |

## 9. Qo'shimchalar (Fresha add-ons)

Onlayn va terminal to'lovlari (O'zbekiston uchun hali yo'q), premium yordam, prognozlar, **Google Rating Boost** (mamnun mijozni Google'da sharh qoldirishga yo'naltiradi), sodiqlik, ma'lumot ulagichi, **AI administrator** (bron qiladi, savollarga javob beradi, beta), **Client Connect** (mijoz bilan ikki tomonlama chat), aqlli sayt, **Team Connect** (xodimlar chati va fayllar), **bron qilinadigan resurslar**, Meta Pixel, Google Analytics, Google Ads. **Chronix'da bularning hech biri yo'q.**

## 10. Sozlamalar

| Fresha imkoniyati | Chronix | Izoh |
|---|---|---|
| Biznes va filiallar | ✅ | filiallar va tarmoq |
| Vaqt mintaqasi, vaqt formati, haftaning birinchi kuni; bron rangi manbai | 🟡 | |
| **Bloklangan vaqt turlari** (tushlik, tozalash...) | ❌ | |
| **Bekor qilish sabablari** ro'yxati | ❌ | |
| **Salonning dam olish davrlari** (bayramlar) | 🟡 | xodim ta'tili bor, salonniki yo'q |
| Chek dizayni: mijoz telefoni va manzili, sarlavha, 2 ta o'z qatori, pastki matn, **chek raqamlash** | 🟡 | chek bor, sozlab bo'lmaydi |
| Soliq stavkalari, xizmat yig'imi, choychaqa sozlamalari, sertifikatlar, o'z to'lov usullari | ❌ | |
| Mijoz manbalari va teglar | ❌ | |
| **Anketa shablonlari** (shablonlar kutubxonasi, imzoli rozilik, kasallik tarixi, telefondan to'ldirish) | ❌ | |

---

## Xulosa: Chronix'da yo'q imkoniyatlar (muhimligi bo'yicha)

### A. Tez qilinadi, foydasi katta (1–3 kun)
1. **"Mijoz keldi" holati** va **bekor qilish sabablari** ro'yxati (hisobotda ham).
2. **Kalendarda vaqtni bloklash** (tushlik, tozalash) — turlari bilan.
3. **Mijoz kartochkasini kengaytirish**: tug'ilgan kun, jins, manba, **teglar**, **allergiya / ogohlantirish (flag)**, bir nechta eslatma.
4. **Xizmatga qo'shimcha vaqt**: kutish (bo'yoq), tozalash (bufer).
5. **QR-kod va o'z bron havolasi** (tanlangan xizmat yoki usta uchun).
6. **Bron tarixi** (kim, qachon, nimani o'zgartirdi) — audit bor, panelda ko'rsatish kerak.
7. **"Qayta bron qilish"** tugmasi (o'sha xizmat, o'sha usta).
8. **Choychaqa** (to'lovda ustaga) va choychaqa hisoboti.

### B. O'rtacha (1 hafta atrofida)
9. **Kutish ro'yxati** (vaqt bo'shasa avtomatik xabar yoki bron).
10. **Takrorlanadigan bron** (har hafta, har 2 haftada...).
11. **Avtomatik xabarlar**: tashrifdan keyin rahmat + sharh so'rash, qayta bron eslatmasi (xizmat bo'yicha N hafta), tug'ilgan kun tabrigi, yo'qolgan mijozni qaytarish, "kelmadi" xabari; eslatma vaqtlarini salon o'zi tanlaydi.
12. **Mijoz guruhlari (segmentlar)** — tayyorlari + qoida bilan o'zi yaratadigan.
13. **Ommaviy xabar yuborish** (push / Telegram / SMS) guruhlarga.
14. **Xizmat narx turlari va variantlari** ("...dan" narx, uzunlik bo'yicha narx).
15. **Kassa smenasi**: ochish, yopish, kirim/chiqim, qoldiq farqi.
16. **Bo'lib to'lash (split)** va to'lanmagan savdo, qoralama.
17. **Mijozlarni import qilish** (Excel) va dublikatlarni birlashtirish; mijozlarni eksport qilish.

### C. Katta ishlar
18. **Anketalar** (shablonlar, imzoli rozilik, bron oldidan telefondan to'ldirish, xizmatga biriktirish) — stomatologiya va LOR uchun muhim.
19. **Resurslar** (xona, kreslo, apparat).
20. **Guruh broni** va **xizmatga qo'shimchalar** / bron paytida qo'shimcha sotuv.
21. **Tabel** (kelib-ketish, tanaffus, davomat) + **PIN bilan kirish**.
22. **Paketlar, abonementlar, sovg'a sertifikatlari** (+ majburiyatlar hisoboti).
23. **Ta'minotchilar va ta'minotchiga buyurtmalar**, inventarizatsiya jarayoni.
24. **Usta natijalari paneli** (bandlik %, mijozni ushlab qolish %).
25. **Aqlli narx** (band soatlarda narxni oshirish — Hot Slots faqat chegirma beradi).
26. **Hisobotlarni kengaytirish**: savdo jurnali, chegirmalar, pul oqimi, sevimlilar va papkalar.

### D. Uzoq muddatli
27. Mijoz bilan ikki tomonlama chat, xodimlar chati.
28. AI administrator (bron qiladi, savollarga javob beradi), sharhlarga AI bilan javob.
29. Google orqali bron, Instagram/Facebook bron tugmasi, Google sharhlarini ulash, Meta Pixel / Google Analytics.
30. Onlayn oldindan to'lov va depozit (Payme/Click) — kelmay qolishni kamaytiradi.
31. Google Calendar bilan sinxronlash.

**Chronix'ning Fresha'dan ustun tomonlari:** O'zbekiston to'lov usullari (Click, Payme, Uzum), Telegram orqali kirish va kod yuborish, budilnikli eslatma, "Mijoz bilan bog'laning" ogohlantirishi, oylikdan avans ayirish, tarmoq obunasi, o'zbek tili, stomatologiya va LOR yo'nalishlari uchun tayyor shablonlar.
