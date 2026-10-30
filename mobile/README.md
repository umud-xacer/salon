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

## Budilnik qanday ishlaydi

| Holat | Android | iOS |
|---|---|---|
| Ilova ochiq | To'liq ekran, ovoz takrorlanadi, tebranish, ekran o'chmaydi | Xuddi shunday |
| Ilova fonda yoki yopiq | `alarm` kanali: maksimal muhimlik, 28 soniyalik signal, bloklangan ekranda ko'rinadi | `time-sensitive` bildirishnoma, ovoz 30 soniyagacha |
| Bildirishnoma bosilganda | To'liq ekranli budilnik ochiladi | Xuddi shunday |

Cheklovlar:
- Bloklangan telefonda o'z-o'zidan to'liq ekran ochilmaydi: `expo-notifications` Android `fullScreenIntent` ni qo'llamaydi. Buning uchun alohida native modul kerak.
- "Bezovta qilmang" rejimini aylanib o'tish uchun foydalanuvchi telefon sozlamasida ruxsat berishi kerak.
- iOS'da ovozsiz rejimni aylanib o'tish (critical alert) Apple'ning alohida ruxsatini talab qiladi.

Ovoz: `assets/sounds/alarm.wav`. Android kanal sozlamasi yaratilgandan keyin o'zgarmaydi, ovozni almashtirsangiz `src/notifications.ts` dagi kanal id sini ham almashtiring (backend `app/services/push.py` bilan birga).
