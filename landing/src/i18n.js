// Landing tarjimalari: UZ / RU. HTML'dagi data-i18n="kalit" elementlar shu lug'atdan to'ldiriladi
// (innerHTML: <em>, <br>, &nbsp; ishlatish mumkin). Tanlangan til localStorage'da saqlanadi, ?lang=ru havolasi ham ishlaydi.
const KEY = "chronix-lang";
export const LANGS = ["uz", "ru"];

export function currentLang() {
  const q = new URLSearchParams(location.search).get("lang");
  if (LANGS.includes(q)) {
    try { localStorage.setItem(KEY, q); } catch { /* xususiy oyna */ }
    return q;
  }
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* xususiy oyna */ }
  return (navigator.language || "").toLowerCase().startsWith("ru") ? "ru" : "uz";
}

export function saveLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* xususiy oyna */ }
}

const T = {
  uz: {
    "meta.title": "Chronix — vaqtingiz, bizning ustuvorligimiz",
    "meta.desc": "Chronix — go'zallik salonlari, stomatologiyalar, Lor klinikalari va Wellness & Spa markazlari uchun onlayn bron va boshqaruv platformasi.",
    "loader.tag": "Vaqtingiz — bizning ustuvorligimiz",
    "nav.features": "Imkoniyatlar", "nav.verticals": "Yo'nalishlar", "nav.prices": "Narxlar", "nav.about": "Biz haqimizda",
    "nav.login": "Kirish", "nav.menu": "Menyu",
    "dots.salon": "Salon", "dots.dental": "Stomatologiya", "dots.ent": "Lor", "dots.spa": "Spa",
    "hero.m1": "<b>Bron va boshqaruv</b>Salon, stomatologiya, Lor va spa — bitta tizimda.",
    "hero.m2": "<b>O'zbekistonda yaratilgan</b>O'zbek va rus tilida, mahalliy xarita va to'lovlar bilan.",
    "hero.live": "Hozir onlayn bron qabul qilinmoqda",
    "hero.title": "Biznesingizni <em>Chronix</em> bilan yangi bosqichga ko'taring",
    "hero.lead": "Onlayn bron, kalendar, kassa, ombor va hisobotlar — bitta joyda. Mijozlaringiz navbatni telefondan bir necha soniyada band qiladi.",
    "store.get": "Yuklab oling", "store.biz": "Muassasalar uchun", "store.panel": "Panelga kirish",
    "stat.1": "yo'nalish", "stat.2": "onlayn bron", "stat.3": "oldin eslatma", "stat.min": " daq",
    "card.1b": "Bron tasdiqlandi", "card.1s": "Bugun, 15:30 · Soch olish",
    "card.2b": "Eslatma", "card.2s": "Qabulingizga 30 daqiqa qoldi",
    "card.3s": "Mijozlar bahosi",
    "hero.down": "Pastga",
    "manifest.label": "( Chronix haqida )",
    "manifest.text": "Chronix — salonlar, klinikalar va spa markazlari uchun vaqtni boshqaradigan platforma. Mijoz navbatda kutmaydi, usta va shifokor kunini aniq biladi, tadbirkor esa qog'oz daftar o'rniga biznesini o'stiradi.",

    "salon.eyebrow": "Sartaroshxona va go'zallik salonlari",
    "salon.title": "Har bir usta jadvali&nbsp;— <em>bir qarashda</em>",
    "salon.text": "Soch turmaklari, tirnoq dizayni va estetik parvarish. Mijoz ustani va bo'sh vaqtni o'zi tanlaydi, siz esa kalendarda hamma bronlarni ko'rasiz — bir-biriga to'qnashmaydi.",
    "salon.t1": "Ustalar ish jadvali va dam olish kunlari", "salon.t2": "Xizmat davomiyligi har bir ustaga alohida",
    "salon.t3": "Kassa, ombor va ustalar oyligi avtomatik",
    "salon.ui": "<b>Bugun</b><span>6 ta bron</span>",
    "salon.r1": "10:00 · Ayollar soch turmagi", "salon.r2": "11:30 · Manikyur", "salon.r3": "13:00 · Soch va soqol",

    "dental.eyebrow": "Stomatologiya klinikalari",
    "dental.title": "Tabassum uchun&nbsp;— <em>tartibli qabul</em>",
    "dental.text": "Terapevtik davolash, ortodontiya, protezlash va jarrohlik — xizmatlar bo'limlarga ajratilgan. Bemor mutaxassislikni, shifokorni va vaqtni tanlab, qabulga o'zi yoziladi.",
    "dental.t1": "6 bo'lim, 22 ta tayyor tibbiy xizmat — bir bosishda", "dental.t2": "Stomatolog-terapevt, ortodont, implantolog…",
    "dental.t3": "Tasdiqlanmagan bron vaqtida avtomatik bekor bo'ladi",
    "dental.ui": "<b>Mutaxassislik</b><span>Ortodont · 2</span>",
    "dental.c1": "Terapevtik", "dental.c2": "Gigiyena", "dental.c3": "Ortodontiya", "dental.c4": "Implant",
    "dental.r1": "Breketni tuzatish · 30 daq",

    "ent.eyebrow": "Lor (otorinolaringologiya)",
    "ent.title": "Quloq, burun, tomoq&nbsp;— <em>aniq yo'naltirish</em>",
    "ent.text": "Endoskopik ko'rik, audiometriya, burun va tomoq muolajalari. Bemor kerakli Lor-shifokorni tanlaydi, registrator esa barcha qabullarni bitta ekranda boshqaradi.",
    "ent.t1": "5 bo'lim, 18 ta Lor xizmati tayyor", "ent.t2": "Lor-shifokor, bolalar Lor-shifokori, Lor-jarroh, audiolog",
    "ent.t3": "Qabulga 30 daqiqa qolganda eslatma",
    "ent.ui": "<b>Qabullar</b><span>Lor-shifokor</span>", "ent.r1": "Audiometriya · 30 daq",

    "spa.eyebrow": "Wellness &amp; Spa markazlari",
    "spa.title": "Hordiq ham&nbsp;— <em>o'z vaqtida</em>",
    "spa.text": "Massaj turlari, sauna va hammom, tana parvarishi hamda kompleks paketlar. Mijoz dam olishni rejalashtiradi, mutaxassislaringiz esa bandligini aniq biladi.",
    "spa.t1": "Massaj, sauna, detoks va kompleks paketlar", "spa.t2": "SPA-terapevt, massajchi, aromaterapevt",
    "spa.t3": "Mijoz baholari va sharhlari",
    "spa.ui": "<b>Paket</b><span>180 daq</span>", "spa.r1": "Massaj + hammom + skrab", "spa.r2": "Detoks kuni",

    "mega.1": "Onlayn bron · Kalendar · Kassa · Ombor · Hisobotlar ·&nbsp;",
    "mega.2": "Salon · Stomatologiya · Lor · Wellness &amp; Spa ·&nbsp;",

    "f.label": "( Imkoniyatlar )",
    "f1.title": "Onlayn bron<br />va eslatmalar",
    "f1.text": "Mijoz xaritadan yaqin muassasani topadi, xizmat, mutaxassis va vaqtni tanlab bron qiladi.",
    "f1.list": "<li>Mobil ilova — iOS va Android</li><li>30 daqiqa oldin \"Boraman / Bormayman\"</li><li>Tasdiqlanmagan bron avtomatik bekor</li>",
    "f2.title": "Kalendar, kassa<br />va ombor",
    "f2.text": "Barcha xodimlar bronlari bitta ekranda — to'qnashuvdan himoya, tanaffuslar va ish soatlari hisobga olinadi.",
    "f2.list": "<li>Naqd, karta va o'tkazmalar, kassa yopish</li><li>Mahsulot qoldig'i va ogohlantirish</li><li>Har bir xodimga o'z huquqi</li>",
    "f2.ring": "bandlik",
    "f3.title": "Hisobotlar<br />va oylik",
    "f3.text": "Daromad, xizmatlar va xodimlar samaradorligi — Excel'ga bir bosishda. Oylik foiz yoki stavka bo'yicha avtomatik.",
    "f3.list": "<li>Kunlik, haftalik, oylik hisobot</li><li>Oldingi davr bilan solishtirish</li><li>Ma'lumotlar baza darajasida himoyalangan</li>",

    "steps.label": "( Qanday boshlanadi )",
    "s1.title": "Ariza qoldiring.", "s1.text": "Biz muassasangizni tizimga qo'shamiz va direktor loginini beramiz.",
    "s2.title": "Sozlang.", "s2.text": "Tayyor tavsiya xizmatlarni bir bosishda qo'shing, xodimlar va ish vaqtini belgilang.",
    "s3.title": "Bron qabul qiling.", "s3.text": "Muassasangiz ilovada va xaritada paydo bo'ladi — mijozlar yozila boshlaydi.",
    "steps.list": "<li class=\"on\">Ariza</li><li>Sozlash</li><li>Bron</li>",

    "prices.label": "( Narxlar )",
    "prices.title": "Biznesingiz hajmiga <em>mos tarif</em>",
    "prices.text": "Mijozlar uchun ilova bepul. Muassasa oylik obuna to'laydi.",
    "prices.cta": "Ulanish",

    "about.label": "( Biz haqimizda )",
    "about.title": "Vaqtingiz&nbsp;— <em>bizning ustuvorligimiz</em>",
    "about.p1": "Chronix — O'zbekistonda yaratilgan bulutli platforma. Maqsadimiz oddiy: mijoz navbatda kutmasin, tadbirkor esa qog'oz daftar va cheksiz qo'ng'iroqlar o'rniga biznesini rivojlantirish bilan band bo'lsin.",
    "about.p2": "Har bir yo'nalish — salon, stomatologiya, Lor va spa — o'z atamalari va tayyor xizmatlari bilan keladi.",
    "contact.label": "( Aloqa )", "contact.title": "Biznesingizni ulang",
    "contact.text": "Qo'ng'iroq qiling yoki Telegram'da yozing — muassasangizni bir kunda tizimga qo'shamiz.",
    "contact.tg": "Telegram'da yozish",

    "footer.title": "Bugun boshlang&nbsp;— <em>ertaga vaqtni yutasiz</em>",
    "footer.top": "Yuqoriga ↑", "footer.contact": "Aloqa",
    "toast.play": "Google Play'da tez orada!", "toast.appstore": "App Store'da tez orada!", "toast.soon": "Tez orada!",
  },

  ru: {
    "meta.title": "Chronix — ваше время в приоритете",
    "meta.desc": "Chronix — платформа онлайн-записи и управления для салонов красоты, стоматологий, ЛОР-клиник и центров Wellness & Spa.",
    "loader.tag": "Ваше время — наш приоритет",
    "nav.features": "Возможности", "nav.verticals": "Направления", "nav.prices": "Цены", "nav.about": "О нас",
    "nav.login": "Войти", "nav.menu": "Меню",
    "dots.salon": "Салон", "dots.dental": "Стоматология", "dots.ent": "ЛОР", "dots.spa": "Спа",
    "hero.m1": "<b>Запись и управление</b>Салон, стоматология, ЛОР и спа — в одной системе.",
    "hero.m2": "<b>Создано в Узбекистане</b>На узбекском и русском, с местными картами и оплатой.",
    "hero.live": "Сейчас принимаем онлайн-записи",
    "hero.title": "Выведите бизнес на новый уровень с&nbsp;<em>Chronix</em>",
    "hero.lead": "Онлайн-запись, календарь, касса, склад и отчёты — в одном месте. Клиенты записываются с телефона за несколько секунд.",
    "store.get": "Загрузите в", "store.biz": "Для заведений", "store.panel": "Вход в панель",
    "stat.1": "направления", "stat.2": "онлайн-запись", "stat.3": "напоминание до визита", "stat.min": " мин",
    "card.1b": "Запись подтверждена", "card.1s": "Сегодня, 15:30 · Стрижка",
    "card.2b": "Напоминание", "card.2s": "До приёма осталось 30 минут",
    "card.3s": "Оценка клиентов",
    "hero.down": "Вниз",
    "manifest.label": "( О Chronix )",
    "manifest.text": "Chronix — платформа, которая управляет временем салонов, клиник и спа-центров. Клиент не ждёт в очереди, мастер и врач точно знают свой день, а владелец растит бизнес вместо бумажного журнала.",

    "salon.eyebrow": "Барбершопы и салоны красоты",
    "salon.title": "График каждого мастера&nbsp;— <em>с одного взгляда</em>",
    "salon.text": "Стрижки и укладки, дизайн ногтей и эстетический уход. Клиент сам выбирает мастера и свободное время, а вы видите все записи в календаре — без накладок.",
    "salon.t1": "График работы и выходные мастеров", "salon.t2": "Длительность услуги — отдельно для каждого мастера",
    "salon.t3": "Касса, склад и зарплата мастеров — автоматически",
    "salon.ui": "<b>Сегодня</b><span>6 записей</span>",
    "salon.r1": "10:00 · Женская укладка", "salon.r2": "11:30 · Маникюр", "salon.r3": "13:00 · Стрижка и борода",

    "dental.eyebrow": "Стоматологические клиники",
    "dental.title": "Для улыбки&nbsp;— <em>чёткий приём</em>",
    "dental.text": "Терапия, ортодонтия, протезирование и хирургия — услуги разделены по отделениям. Пациент сам выбирает специализацию, врача и время приёма.",
    "dental.t1": "6 отделений, 22 готовые медицинские услуги — в один клик", "dental.t2": "Стоматолог-терапевт, ортодонт, имплантолог…",
    "dental.t3": "Неподтверждённая запись отменяется автоматически",
    "dental.ui": "<b>Специализация</b><span>Ортодонт · 2</span>",
    "dental.c1": "Терапия", "dental.c2": "Гигиена", "dental.c3": "Ортодонтия", "dental.c4": "Импланты",
    "dental.r1": "Коррекция брекетов · 30 мин",

    "ent.eyebrow": "ЛОР (оториноларингология)",
    "ent.title": "Ухо, горло, нос&nbsp;— <em>точная запись</em>",
    "ent.text": "Эндоскопический осмотр, аудиометрия, процедуры для носа и горла. Пациент выбирает нужного ЛОР-врача, а регистратор управляет всеми приёмами на одном экране.",
    "ent.t1": "5 отделений, 18 готовых ЛОР-услуг", "ent.t2": "ЛОР-врач, детский ЛОР, ЛОР-хирург, аудиолог",
    "ent.t3": "Напоминание за 30 минут до приёма",
    "ent.ui": "<b>Приёмы</b><span>ЛОР-врач</span>", "ent.r1": "Аудиометрия · 30 мин",

    "spa.eyebrow": "Центры Wellness &amp; Spa",
    "spa.title": "И отдых&nbsp;— <em>вовремя</em>",
    "spa.text": "Виды массажа, сауна и хаммам, уход за телом и комплексные программы. Клиент планирует отдых, а ваши специалисты точно знают свою загрузку.",
    "spa.t1": "Массаж, сауна, детокс и комплексные программы", "spa.t2": "СПА-терапевт, массажист, ароматерапевт",
    "spa.t3": "Оценки и отзывы клиентов",
    "spa.ui": "<b>Программа</b><span>180 мин</span>", "spa.r1": "Массаж + хаммам + скраб", "spa.r2": "День детокса",

    "mega.1": "Онлайн-запись · Календарь · Касса · Склад · Отчёты ·&nbsp;",
    "mega.2": "Салон · Стоматология · ЛОР · Wellness &amp; Spa ·&nbsp;",

    "f.label": "( Возможности )",
    "f1.title": "Онлайн-запись<br />и напоминания",
    "f1.text": "Клиент находит ближайшее заведение на карте, выбирает услугу, специалиста и время.",
    "f1.list": "<li>Мобильное приложение — iOS и Android</li><li>За 30 минут: «Приду / Не приду»</li><li>Неподтверждённая запись отменяется сама</li>",
    "f2.title": "Календарь, касса<br />и склад",
    "f2.text": "Записи всех сотрудников на одном экране — защита от накладок, учёт перерывов и рабочих часов.",
    "f2.list": "<li>Наличные, карта и переводы, закрытие кассы</li><li>Остатки товаров и уведомления</li><li>У каждого сотрудника свои права</li>",
    "f2.ring": "загрузка",
    "f3.title": "Отчёты<br />и зарплата",
    "f3.text": "Выручка, услуги и эффективность сотрудников — в Excel одним нажатием. Зарплата по проценту или ставке — автоматически.",
    "f3.list": "<li>Отчёты за день, неделю, месяц</li><li>Сравнение с прошлым периодом</li><li>Данные защищены на уровне базы</li>",

    "steps.label": "( Как начать )",
    "s1.title": "Оставьте заявку.", "s1.text": "Мы добавим ваше заведение в систему и выдадим логин директора.",
    "s2.title": "Настройте.", "s2.text": "Добавьте готовые услуги в один клик, укажите сотрудников и часы работы.",
    "s3.title": "Принимайте записи.", "s3.text": "Заведение появится в приложении и на карте — клиенты начнут записываться.",
    "steps.list": "<li class=\"on\">Заявка</li><li>Настройка</li><li>Запись</li>",

    "prices.label": "( Цены )",
    "prices.title": "Тариф под <em>размер бизнеса</em>",
    "prices.text": "Для клиентов приложение бесплатно. Заведение оплачивает ежемесячную подписку.",
    "prices.cta": "Подключиться",

    "about.label": "( О нас )",
    "about.title": "Ваше время&nbsp;— <em>наш приоритет</em>",
    "about.p1": "Chronix — облачная платформа, созданная в Узбекистане. Наша цель проста: клиент не должен ждать в очереди, а предприниматель — заниматься развитием бизнеса вместо бумажного журнала и бесконечных звонков.",
    "about.p2": "Каждое направление — салон, стоматология, ЛОР и спа — работает со своими терминами и готовыми услугами.",
    "contact.label": "( Контакты )", "contact.title": "Подключите свой бизнес",
    "contact.text": "Позвоните или напишите в Telegram — мы подключим ваше заведение за один день.",
    "contact.tg": "Написать в Telegram",

    "footer.title": "Начните сегодня&nbsp;— <em>завтра выиграете время</em>",
    "footer.top": "Наверх ↑", "footer.contact": "Контакты",
    "toast.play": "Скоро в Google Play!", "toast.appstore": "Скоро в App Store!", "toast.soon": "Скоро!",
  },
};

export const PLAN_TEXT = {
  ru: {
    period: "сум / мес",
    "Kelishiladi": "По договорённости",
    "Kichik salon yoki kabinet": "Небольшой салон или кабинет",
    "Eng ko'p tanlanadi": "Выбирают чаще всего",
    "Tarmoq va katta klinikalar": "Сети и крупные клиники",
    "3 tagacha xodim": "До 3 сотрудников", "Onlayn bron va kalendar": "Онлайн-запись и календарь",
    "Mobil ilovada ko'rinish": "Показ в мобильном приложении", "Eslatmalar": "Напоминания",
    "10 tagacha xodim": "До 10 сотрудников", "Kassa va xarajatlar": "Касса и расходы", "Ombor": "Склад",
    "Oylik hisob-kitob": "Расчёт зарплаты", "Hisobotlar va Excel": "Отчёты и Excel",
    "Cheksiz xodim": "Без ограничения сотрудников", "Barcha modullar": "Все модули",
    "Bir nechta filial": "Несколько филиалов", "Shaxsiy menejer": "Персональный менеджер",
  },
};

export function t(lang, key) {
  return T[lang]?.[key] ?? T.uz[key] ?? key;
}

/** data-i18n, data-i18n-attr="aria-label:kalit" elementlarni tanlangan tilga o'tkazadi (split'dan OLDIN chaqiriladi) */
export function applyLang(lang) {
  document.documentElement.lang = lang;
  document.title = t(lang, "meta.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t(lang, "meta.desc"));
  if (lang === "uz") return;   // HTML'ning o'zi o'zbekcha
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.innerHTML = t(lang, el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.dataset.i18nAttr.split(";").forEach((pair) => {
      const [attr, k] = pair.split(":");
      el.setAttribute(attr.trim(), t(lang, k.trim()));
    });
  });
}
