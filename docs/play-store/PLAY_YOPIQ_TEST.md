# Chronix APP — Google Play yopiq test: qolgan qadamlar (2026-11-23)

Ilova: **Chronix APP**, paket `uz.chronix.app`, Play Console hisobi "Chronix UZ" (chronixuz@gmail.com).
Yopiq test treki: **Закрытое тестирование – Alpha**, ro'yxat "Chronix sinovchilar" (15 Gmail), mamlakat — O'zbekiston.
Sinovchilar havolasi (reliz tasdiqlangach ishlaydi): https://play.google.com/apps/testing/uz.chronix.app

## Holat

| Bo'lim | Holat |
|---|---|
| Do'kon sahifasi (ru-RU, ikonka, banner, 8 skrinshot) | ✅ |
| Maxfiylik siyosati, reklama (yo'q), yosh reytingi (IARC) | ✅ |
| Davlat ilovasi — yo'q, moliya — yo'q, sog'liq — "Медицинские услуги", Ad ID — yo'q, sotuvchi maqomi — ha | ✅ |
| Ma'lumotlar xavfsizligi (12 tur) | ✅ |
| **Учетные данные** (tekshiruvchi uchun login) | ✅ egasi kiritdi |
| **Целевая аудитория** (16–17, 18+) | ✅ |
| Kategoriya "Красота", aloqa: chronixuz@gmail.com, https://chronix.uz | ✅ 2026-11-24 |
| .aab (1.0.2, versionCode 5) + Alpha relizi | ✅ 2026-11-24 Google tekshiruviga yuborildi (16 o'zgarish) |
| App signing SHA-1 → Google Cloud | ✅ 2026-11-24 Android client "Chronix Play" (SHA-1 `F2:69:06:00:3B:E3:76:7E:69:1F:11:23:04:47:37:B7:42:C3:A7:DB`) |

Eslatma: Play "android.hardware.screen.portrait" ogohlantirishini berdi (ilova faqat vertikal) — "Продолжить все равно"
bilan o'tkazildi. Keyingi build'da kerak bo'lsa manifestda `required="false"` qilinadi; telefonlar uchun ta'sir yo'q.

## 1. "Учетные данные" (faqat egasi kiritadi — parol)

Play Console → Контент приложения → **Учетные данные** → "Да" → **+ Сведения об эксперименте**:
- Имя пользователя: sinov raqami, Пароль: parol — `loyxalar/PLAY_TEST_LOGIN.md` ("2026-11-17" bo'limi; repo'da emas).
- Инструкции: o'sha fayldagi inglizcha izoh to'liq.
- "Добавить" → "Сохранить".

Server tomoni tekshiruvi: sinov hisobi ishlashi uchun serverda u mavjud va faol bo'lishi kerak (parol bilan kirish).
Ilovada: Profil → Kirish → «Parol bilan kirish» → raqam va parol. Kirib bo'lmasa — serverda parolni qayta o'rnatish kerak.

## 2. "Целевая аудитория и возрастные ограничения"

- Yosh guruhlari: **16–17** va **18 и старше** (15 va kichiklar belgilanmaydi — maxfiylik siyosatida "16 yoshdan katta").
- "Может ли приложение быть привлекательным для детей?" — **Нет**.
- Do'kon sahifasida bolalarga qaratilgan reklama/grafika yo'q.

## 3. Ma'lumotlar xavfsizligi — PLAY_CONSOLE_JAVOBLAR.md dan farq

Play formasida hamma tur **"Собирает"** (yig'iladi), **"Передает" belgilanmagan**. Sabab: Google qoidasi bo'yicha
foydalanuvchi o'zi boshlagan uzatish (mijoz o'zi bron qilgan salonga ismi va raqami boradi) "передача" hisoblanmaydi.
Uchinchi tomon SDK (reklama, analitika xizmati) yo'q; analitika o'z serverimizda. Eskiz (SMS) — xizmat ko'rsatuvchi
(service provider), u ham "передача" emas. Agar keyin tashqi analitika/reklama SDK qo'shilsa — forma yangilanadi.

Sog'liq: "Медицинские услуги и управление здравоохранением" belgilangan — ilova stomatologiya/LOR klinikalariga
yozilish imkonini beradi (tibbiy ma'lumot ilovada saqlanmaydi; bemor anketalari faqat biznes panelida).

## 4. .aab yuklash va reliz

1. Fayl: EAS build `8ab9976c` (1.0.2, versionCode 5) — `expo.dev` → Builds → Download (.aab).
   Yangi build kerak bo'lsa: `cd salon/mobile && npx eas-cli build --platform android --profile production`.
2. Play Console → Тестирование → Закрытое тестирование → Alpha → **Создать выпуск**.
3. "Подписание приложений Google Play" — **Google tomonidan boshqariladigan kalit** (standart) qoldiriladi.
4. .aab yuklanadi; "Название выпуска" — 1.0.2 (5); "Примечания к выпуску" (ru-RU):
   `Первая версия для закрытого тестирования: поиск салонов, онлайн-запись, лист ожидания, напоминания.`
5. Ogohlantirishlar:
   - **USE_FULL_SCREEN_INTENT** — "Нет" (asosiy funksiya emas; budilnik — qo'shimcha eslatma). PLAY_CONSOLE_JAVOBLAR.md 5a.
   - **AD_ID** — Play "manifestda AD_ID bor" desa: deklaratsiya "Нет" turibdi; ilova reklama ID ishlatmaydi.
     `app.json` → `blockedPermissions` ga `com.google.android.gms.permission.AD_ID` qo'shildi (2026-11-23) —
     keyingi build'da manifestdan chiqadi (8ab9976c build'da hali bo'lishi mumkin).
6. "Далее" → "Сохранить" → **Обзор публикации** → "Отправить на проверку". Tekshiruv odatda 1–3 kun.

## 5. Google bilan kirish: App signing SHA-1 → Google Cloud

Play o'z kaliti bilan qayta imzolaydi, shuning uchun EAS SHA-1 Play'dan o'rnatilgan ilovada ishlamaydi.
1. Play Console → **Защищено Google Play → Целостность приложения → Подписание приложений** →
   "Сертификат ключа подписи приложения" → **SHA-1** ni nusxalash (reliz yaratilgach ko'rinadi).
2. Google Cloud Console → loyiha **chronix-514914** → APIs & Services → Credentials → **Create credentials →
   OAuth client ID** → Application type **Android**:
   - Name: `Chronix Play`
   - Package name: `uz.chronix.app`
   - SHA-1: 1-banddagi qiymat
3. Saqlash. Kod va serverni o'zgartirish shart emas: ilova `google_web_client_id` (Web client) bilan ishlaydi,
   Android client faqat paket + imzoni tasdiqlaydi. Eski EAS (APK) client o'chirilmaydi — APK foydalanuvchilari uchun.
4. Tekshiruv: Play'dan o'rnatilgan ilovada "Google orqali kirish" — xato `DEVELOPER_ERROR` (10) bo'lsa SHA-1 noto'g'ri.

## 6. Sinovchilarga yo'riqnoma (Telegram)

> **Chronix APP sinovi** 🙏
> 1. Telefoningizda ro'yxatga berilgan Gmail bilan kirilganini tekshiring.
> 2. Havolani oching: https://play.google.com/apps/testing/uz.chronix.app
> 3. **"Стать тестировщиком"** ni bosing.
> 4. "Скачать в Google Play" orqali o'rnating.
> 5. **14 kun o'chirmang**, kuniga bir marta ochib turing.

Nazorat: 12-sinovchi qo'shilgan kundan 14 kun sanaladi; 3, 7, 12-kunlarda eslatma; 2–3 kishidan qisqa fikr
yig'ing (production arizasida so'raladi). Qolgan 4 ta chala Gmail aniqlansa — ro'yxatga qo'shiladi.

## 7. 14 kundan keyin

Play Console → Панель управления → **"Подать заявку на доступ к рабочей версии"** — sinov qanday o'tgani,
topilgan xatolar, auditoriya haqida savollar (javoblarni Claude tayyorlaydi). Ko'rib chiqish ~7 kun.

## 8. Keyingi reliz: 1.0.3 (versionCode 6) — 2026-11-24 tayyorlandi

- Commit `f29cd9f`: `plugins/with-optional-screen-features.js` — `android.hardware.screen.portrait/landscape`
  `required="false"` (Play "доступно не на всех устройствах" ogohlantirishi yo'qoladi; ilova baribir faqat vertikal).
- AD_ID: `blockedPermissions` orqali manifestda `tools:node="remove"` (prebuild bilan tekshirildi).
- EAS build `679c0d7e-b137-47e3-b49e-edc800cc85b2` (production, .aab).
- MUHIM: runtimeVersion = appVersion → 1.0.3 alohida OTA kanali. 1.0.2 foydalanuvchilariga OTA `--runtime-version 1.0.2`
  bo'yicha alohida chiqariladi; 1.0.3 o'rnatilgach unga ham OTA kerak bo'lsa — alohida.
- Qachon yuklanadi: 1.0.2 Google tekshiruvidan o'tgach (ko'rib chiqish davomida yangi reliz yuborilsa, tekshiruv qaytadan
  boshlanadi). Alpha → "Создать выпуск" → .aab → "Далее" → "Сохранить" → Обзор публикации → yuborish.

## 9. 2026-11-24: RAD ETILDI — "Требования Play Console" (faqat tashkilot hisobi)

Google matni: ba'zi ilova turlarini faqat tashkilot (korporativ) hisobi chiqara oladi; e'lon qilingan funksiyalar bilan
shaxsiy hisobdan chiqarib bo'lmaydi. Sabab: sog'liq deklaratsiyasida "Медицинские услуги и управление здравоохранением"
(stomatologiya/LOR klinikalariga yozilish). Tanlangan yo'l: **mobil ilovada klinika turini vaqtincha yashirish**.

Kod (`386987b`): mobil ilova har so'rovda `X-Chronix-Client: mobile` yuboradi; server `MOBILE_HIDDEN_KINDS`
(standart `clinic`) turidagi muassasalarni kategoriya, yaqin/qidiruv, xarita, sahifa, Hot Slots, takliflar va
sevimlilardan chiqarmaydi (`backend/app/core/client_filter.py`). Veb, panel va 1.0.2 o'zgarmaydi.
Qaytarish (tashkilot hisobi bo'lgach): serverda `MOBILE_HIDDEN_KINDS=` (bo'sh) — yangi build shart emas.

Qayta yuborish tartibi:
1. **Server deploy** (`386987b`) — busiz 1.0.3 da ham klinikalar ko'rinadi (sarlavhani eski server bilmaydi).
2. Play Console → Контент приложения → **Приложения для здоровья** → "Медицинские услуги и управление
   здравоохранением" belgisini olib tashlash → **"В моем приложении нет функций, связанных со здоровьем"** →
   Далее → Сохранить. (Egasi o'zi qiladi.)
3. Alpha → Создать выпуск → yangi .aab (1.0.3, versionCode 7, EAS `44e11756`, https://expo.dev/artifacts/eas/CMxSZ2Jx9anT0C5NF2sdzcnCZ6MSdPfcwVc6uaUn94I.aab) → примечания →
   Далее → Сохранить. Eski reliz 5 (1.0.2) almashtiriladi.
4. Обзор публикации → "Отправить изменения на проверку".
5. Eslatma: 1.0.3 versionCode 6 (EAS `679c0d7e`) — sarlavhasiz, ISHLATILMAYDI.

Do'kon sahifasi (2026-11-24, Claude bajardi, saqlandi): qisqa/to'liq tavsifdan "стоматологии" olib tashlandi;
skrinshotlar 01 (Stomatolog/LOR kategoriyalari), 02 (LOR chip), 07 (Smile Dental Clinic) olib tashlandi — 5 ta qoldi
(03, 04, 05, 06, 08); banner `feature-graphic-v2.png` ("Salon, barber, go'zallik va SPA"). Keyinroq klinikasiz
yangi bosh sahifa/qidiruv skrinshotlari olinsa — qo'shiladi.
