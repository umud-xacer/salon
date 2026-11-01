# Chronix veb-panel

React + Vite + Tailwind. Ma'lumot faqat API orqali keladi (`/api/v1`), mobil ilova ham shu API'ni ishlatadi.

```bash
npm install
VITE_API_PROXY=http://127.0.0.1:8001 npm run dev    # http://127.0.0.1:5174
npm run build                                       # tiplar tekshiriladi, natija dist/ da
```

## Tuzilma

- `src/modules/registry.tsx`: barcha bo'limlar ro'yxati. Yangi bo'lim uchun `modules/` ga sahifa qo'shib,
  shu yerga bitta yozuv kiriting: menyu, yo'l, modul va huquq tekshiruvi shundan quriladi.
- `src/api/`: fetch va token yangilash (`client.ts`), backend tiplari (`types.ts`).
- `src/auth/AuthProvider.tsx`: `/auth/me`. Obuna va modul o'zgarsa, panel qayta kirmasdan yangilanadi.
- `src/pages/BusinessPanel.tsx`: `/b/:businessId/*`, salon to'xtatilgan bo'lsa qulf sahifasi.

## Panellar

`/auth/me` dagi `panel` maydoni hal qiladi:

| Panel | Rollar | Ko'radi |
| --- | --- | --- |
| `admin` | direktor, menejer, kassir | moliya, boshqaruv (modul va huquqqa qarab) |
| `staff` | usta | faqat o'z bronlari va ish jadvali |

Menyu faqat qulaylik uchun. Haqiqiy himoya bazada (RLS va `app.has_perm`): usta so'rovni qo'lda yuborsa ham
moliya ma'lumotini ololmaydi.

## Obuna

`businesses.is_active = false` yoki `subscription_ends_at` o'tgan bo'lsa, salon to'xtaydi: huquqlar yopiladi,
katalogdan yo'qoladi, eslatma ketmaydi. Ma'lumot o'chirilmaydi. Uzaytirilganda shu joyidan davom etadi.
`status = 'blocked'` alohida: uni to'lov ochmaydi, faqat Super Admin.
