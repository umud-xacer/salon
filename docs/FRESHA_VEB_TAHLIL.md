# fresha.com/ru — veb-sayt tahlili (2026-11-16, Chrome'da qadamma-qadam)

Chronix veb-platformasi (`market/`, chronix.uz) shu tuzilishga moslab quriladi.

## 1. Bosh sahifa (`/ru`)
- **Header:** chapda logotip; o'ngda `Войти`, `Для бизнеса` (pill), `Меню ☰`.
  - Menyu: "Для клиентов" — Вход или регистрация, Скачать приложение, Справочный центр, til (русский); pastda "Для бизнеса →".
- **Hero:** och binafsha/pushti gradient fon, katta qora sarlavha (2 qator), qisqa izoh.
- **Qidiruv paneli** (bitta pill, 3 bo'lak + qora "Поиск"):
  1. `Все услуги` — ochilganda tablar: Все / Процедуры / Заведения / Специалисты, ostida ro'yxat.
  2. `Мое местоположение` — ochilganda "📍 Мое местоположение" (geolokatsiya) + manzil qidirish.
  3. `Любое время` — popover: tezkor tugmalar (Сегодня, Завтra) + oylik kalendar (+ vaqt oralig'i).
- Hisoblagich: "**590 694** записей забронировано сегодня" (raqamlar aylanuvchi animatsiya).
- `Скачать приложение` (QR kod popover).
- **Karusellar** (← → strelkalar): Рекомендуемые, Новое в Fresha, Популярные.
  - Karta: rasm (4:3, yumaloq burchak), ♡ ("Войдите, чтобы добавить в избранное"), nom, ★ reyting, manzil, "Kategoriya • N отзывов", nishon (Best in Class / Highly Recommended / Новое).
- Ilova bloki ("Скачайте приложение Fresha"), mijozlar sharhlari karuseli, statistika (bronlar, hamkorlar, mamlakatlar, mutaxassislar), "Fresha для бизнеса — Подробнее".
- SEO: "Поиск по городу" — mamlakat → shahar → "Kategoriya в Shahar" havolalari; pastda barcha kategoriyalar ro'yxati.

## 2. Qidiruv natijalari (`/search?center=..&category-ids=..`)
- Header'da ixcham qidiruv (xizmat / "Область карты" / vaqt + 🔍).
- Tablar: `Заведения | Специалисты`; "3 тыс.+ мест в пределах области карты"; `Фильтры`; `Скрыть карту`.
- **Kun chiplari:** Любой день, Сегодня, Завтра, ср 18, чт 19 … (gorizontal).
- Chapda 2 ustunli kartalar (rasm karuseli — nuqtalar, nishon, ♡, ✔ tasdiqlangan belgisi, ★, masofa · hudud, kategoriya · sharhlar).
- O'ngda xarita (rasterli), pinlar — qora "★ 5,0" pill; kengaytirish, +/−. Kartaga sichqoncha borganda pin kattalashadi.
- **Filtrlar oynasi:** Сортировать (Лучшие для вас / Ближайшие / С высоким рейтингом), Диапазон цен (slider), Расстояние (slider), Лучшие заведения (Best in Class / Highly Recommended), Для кого (Все / только женщины / только мужчины / дети / взрослые), Удобства и доступ; pastda `Очистить` + `Показать N заведений`.

## 3. Salon sahifasi (`/a/<slug>`)
- Breadcrumb (Главная › kategoriya › mamlakat › shahar › hudud › nom).
- Sarlavha: nom + ✔; "5,0 ★★★★★ (2 586) • Открыто до 19:00 • manzil • Проложить маршрут"; o'ngda Ulashish, ♡.
- **Galereya:** 1 katta + 2 kichik rasm, "Посмотреть все изображения".
- Yopishqoq tab-menyu: Фотографии · Услуги · Команда · Отзывы · Портфолио · Общие сведения.
- **Xizmatlar:** bo'lim chiplari (Рекомендуемые, STYLING, …); qator: nom, davomiylik, narx, `Забронировать`; "Посмотреть все".
- **Jamoa:** dumaloq rasmlar + ism (reyting), "Посмотреть все".
- **Sharhlar:** umumiy baho + nishon + AI xulosa (bizda yo'q — qo'shilmaydi); sharh: avatar, ism, ★, matn, "N дней назад • xizmat • с Usta"; "Посмотрите все N отзывов".
- Портфолио (ish namunalari), Общие сведения (tavsif), **Время работы** (har kun), Дополнительная информация (tasdiqlangan, mgnovennoe podtverjdenie, onlayn to'lov), manzil + xarita.
- **O'ng yopishqoq karta:** nom, reyting, `Забронировать` (qora), ochiq/yopiq, manzil.
- Pastda: Другие заведения (shu tarmoq filiallari), Заведения поблизости, shahar bo'yicha SEO havolalar.

## 4. Bron oqimi (`/a/<slug>/booking?...`) — to'liq sahifa, ✕ va ← bilan
1. **Услуги:** bo'lim chiplari, kartalar (nom, davomiylik, narx, "+" / ✔) — **bir nechta xizmat tanlash mumkin**. O'ngda savat: salon, tanlanganlar, "Всего к оплате", `Продолжить →`.
2. **Специалист:** "Любой специалист — все доступные" + ustalar ro'yxati (rasm, ism, `Выбрать`). Qadam ko'rsatkichi: Услуги › Специалист › Время › Подтвердить.
3. **Время:** usta tanlovi (dropdown), kalendar tugmasi, kun kartochkalari (hafta kuni, sana, oy), vaqt ro'yxati.
4. **Add-on taklifi** (modal): "Добавить дополнительную услугу?" — ro'yxat + "Нет, спасибо".
5. **Kirish** (modal): "Войдите или зарегистрируйтесь, чтобы бронировать" — email, "Войти через мобильный телефон", Google (+ boshqalar).
6. Tasdiqlash (kirgandan keyin) — tahlil shu yerda to'xtatildi (haqiqiy bron qilinmadi).

## Chronix'ga moslash
| Fresha | Chronix |
|---|---|
| Bir nechta xizmat + add-on taklifi | 2-bosqich (bazada bitta bron = bitta xizmat) |
| Email bilan kirish | SMS / Telegram / Google (bizda telefon majburiy) |
| AI xulosa, onlayn to'lov, sovg'a sertifikati | Yo'q (foydalanuvchi ilgari "kerak emas" degan) |
| Best in Class nishoni | "Tavsiya etilgan" — reytingdan (≥4,8 va ≥ N sharh) |
| Specialist qidiruvi | Keyinroq |
| Hot Slots | Bizda bor — bosh sahifa va salon sahifasida |
