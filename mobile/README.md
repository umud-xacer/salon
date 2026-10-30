# Mobil ilova (Expo + React Native)

Hozircha mijoz qismi: kirish, salonlar, bron, bronlarim, xabarlar, budilnik.
Usta ilovada budilnik ekranini va qo'ng'iroq tugmasini oladi; to'liq ishchi oyna keyingi bosqichda.

## Ishga tushirish

```powershell
cd mobile
npm install
$env:EXPO_PUBLIC_API_URL = "http://KOMPYUTER_IP:8001"   # telefon va kompyuter bitta Wi-Fi'da
npx expo start
```
API'ni tashqaridan ko'rinadigan qiling: `uvicorn app.main:app --host 0.0.0.0 --port 8001`.
Fon jarayoni alohida: `python -m app.worker`.

## Push va budilnik uchun development build kerak

Expo Go'da (Android) masofaviy push ishlamaydi, maxsus ovoz ham faqat build'da ishlaydi.

```powershell
npx eas login
npx eas init                                          # app.json ga projectId yoziladi
npx eas credentials                                   # Android: FCM kaliti (Firebase loyihasi kerak)
npx eas build --profile development --platform android
```

## Yandex xarita

Yandex kabinetidan JavaScript API kaliti oling va ishga tushirishdan oldin bering:
```powershell
$env:EXPO_PUBLIC_YANDEX_MAPS_KEY = "kalit"
```
Xarita `react-native-webview` ichida JS API 2.1 orqali ishlaydi. Kalitda domen cheklovi qo'ysangiz, `salon-app.uz` ni qo'shing
(`src/YandexMap.tsx` dagi `BASE_URL`). Kalit ilova ichiga tushadi, bu JS API uchun odatiy holat.

## Budilnik qanday ishlaydi

Android'da bitta eslatma uchun ikki push ketadi:
1. **Ko'rinadigan** (`alarm` kanali): maksimal muhimlik, 28 soniyalik signal. Zaxira: ikkinchisi ishlamasa ham shu keladi.
2. **Ko'rinmas** (`_contentAvailable`): ilovani fonda uyg'otadi, `src/alarmTask.ts` ishga tushadi va `modules/salon-alarm` to'liq ekranli
   bildirishnoma qo'yadi. Telefon bloklangan bo'lsa, `salon://alarm` ekrani o'zi ochiladi, ekranni yoqadi, ovoz takrorlanadi.

| Holat | Android | iOS |
|---|---|---|
| Ilova ochiq | To'liq ekran, ovoz takrorlanadi, tebranish | Xuddi shunday |
| Telefon bloklangan | Budilnik ekrani o'zi ochiladi | `time-sensitive` bildirishnoma, bosilganda ekran ochiladi |
| Telefon ochiq, boshqa ilovada | Yuqoridan banner va signal, bosilganda ekran ochiladi | Xuddi shunday |

Cheklovlar:
- Android 14+ da to'liq ekran ruxsati kerak. Ruxsat o'chiq bo'lsa, Profil ekranida tugma chiqadi. Google Play bu ruxsatni faqat budilnik va qo'ng'iroq ilovalariga beradi, chiqarishda ariza kerak bo'lishi mumkin.
- Foydalanuvchi ilovani sozlamalardan "majburan to'xtatsa", ko'rinmas push ishlamaydi. Doze rejimida Android kechiktirishi mumkin.
- Ba'zi telefonlarda (Xiaomi, Oppo va boshqalar) batareya tejash fon ishini to'xtatadi.
- "Bezovta qilmang" rejimini aylanib o'tish uchun foydalanuvchi telefon sozlamasida ruxsat berishi kerak.
- iOS'da bloklangan ekranni ilova egallay olmaydi. Ovozsiz rejimni aylanib o'tish (critical alert) Apple'ning alohida ruxsatini talab qiladi.
- `modules/salon-alarm` Kotlin kodi hali kompilyatsiya qilinmagan: birinchi EAS build uni tekshiradi.

Ovoz: `assets/sounds/alarm.wav`. Android kanal sozlamasi yaratilgandan keyin o'zgarmaydi, ovozni almashtirsangiz `src/notifications.ts` dagi kanal id sini ham almashtiring (backend `app/services/push.py` bilan birga).
