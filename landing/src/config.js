// Sayt sozlamalari — havolalar va tariflar shu yerda o'zgartiriladi.
// Bo'sh havola ("") bosilsa "Tez orada" xabari chiqadi.
export const LINKS = {
  panel: "https://www.ariqalqon.uz/",          // direktor / xodimlar paneli (login)
  play: "",                                     // Google Play sahifasi — ilova chiqqanda qo'yiladi
  appstore: "",                                 // App Store sahifasi — Apple Developer hisobidan keyin
  phone: "+998200035599",
  telegram: "https://t.me/JabborqulovUmidjon",
};

// DIQQAT: narxlar vaqtinchalik namunadir — haqiqiy tariflarni shu yerga yozing.
export const PLANS = [
  {
    name: "Start",
    price: "199 000",
    period: "so'm / oy",
    note: "Kichik salon yoki kabinet",
    features: ["3 tagacha xodim", "Onlayn bron va kalendar", "Mobil ilovada ko'rinish", "Eslatmalar"],
  },
  {
    name: "Biznes",
    price: "399 000",
    period: "so'm / oy",
    note: "Eng ko'p tanlanadi",
    featured: true,
    features: ["10 tagacha xodim", "Kassa va xarajatlar", "Ombor", "Oylik hisob-kitob", "Hisobotlar va Excel"],
  },
  {
    name: "Premium",
    price: "Kelishiladi",
    period: "",
    note: "Tarmoq va katta klinikalar",
    features: ["Cheksiz xodim", "Barcha modullar", "Bir nechta filial", "Shaxsiy menejer"],
  },
];
