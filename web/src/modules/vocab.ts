// Muassasa ish tartibiga qarab panel yozuvlari (TZ 5-band). Tartibni Super Admin turda belgilaydi.
// Klinika va stomatologiyada "usta" emas — "shifokor". Panel ichida useVocab() bilan olinadi.
import { createContext, useContext } from "react";

export type BusinessKind = "salon" | "pharmacy" | "clinic";

export interface Vocab {
  staff: string;          // bo'lim nomi
  staffOne: string;       // bitta xodim (Usta / Shifokor)
  staffMany: string;      // gap ichida: "barcha ustalar" / "barcha shifokorlar"
  staffAny: string;       // "Istalgan usta"
  staffDative: string;    // "ustaga berildi"
  receptionOne: string;   // qabulxona roli: salonda "Kassir", klinikada "Registrator"
  services: string;
  serviceOne: string;
  clients: string;
  clientOne: string;
  inventory: string;
  product: string;
  calendar: string;
  businessPage: string;  // "Salon" bo'limi nomi
  place: string;         // gap ichida: "salon" / "klinika"
  titles?: string[];     // lavozim/mutaxassislik tavsiyalari (Super Admin turda belgilaydi)
}

const VOCAB: Record<BusinessKind, Vocab> = {
  salon: {
    staff: "Xodimlar", staffOne: "Usta", staffMany: "ustalar", staffAny: "Istalgan usta", staffDative: "ustaga", receptionOne: "Kassir",
    services: "Xizmatlar", serviceOne: "Xizmat", clients: "Mijozlar", clientOne: "Mijoz",
    inventory: "Ombor", product: "Mahsulot", calendar: "Kalendar", businessPage: "Salon", place: "salon",
  },
  pharmacy: {
    staff: "Farmatsevtlar", staffOne: "Farmatsevt", staffMany: "farmatsevtlar", staffAny: "Istalgan farmatsevt",
    staffDative: "farmatsevtga", receptionOne: "Kassir", services: "Xizmatlar", serviceOne: "Xizmat", clients: "Xaridorlar", clientOne: "Xaridor",
    inventory: "Dorilar va tibbiy buyumlar", product: "Dori", calendar: "Navbat", businessPage: "Dorixona", place: "dorixona",
  },
  clinic: {
    staff: "Shifokorlar", staffOne: "Shifokor", staffMany: "shifokorlar", staffAny: "Istalgan shifokor",
    staffDative: "shifokorga", receptionOne: "Registrator", services: "Tibbiy xizmatlar", serviceOne: "Tibbiy xizmat",
    clients: "Bemorlar", clientOne: "Bemor", inventory: "Ombor", product: "Mahsulot", calendar: "Qabullar",
    businessPage: "Klinika", place: "klinika",
  },
};

export const vocabFor = (kind: string | undefined): Vocab => VOCAB[(kind as BusinessKind) ?? "salon"] ?? VOCAB.salon;

// Panel ichidagi komponentlar uchun (BusinessPanel va Super Admin muassasa oynasi beradi)
export const VocabContext = createContext<Vocab>(VOCAB.salon);
export const useVocab = () => useContext(VocabContext);

// Rol nomi: oddiy xodim — turga qarab (Usta / Shifokor / Farmatsevt)
export const roleLabel = (role: string, v: Vocab) =>
  ({ owner: "Direktor", manager: "Menejer", receptionist: v.receptionOne, staff: v.staffOne } as Record<string, string>)[role] ?? role;

export const KIND_LABELS: Record<BusinessKind, string> = {
  salon: "Salon: ustalar, xizmatlar, vaqtga bron",
  pharmacy: "Dorixona: farmatsevtlar, dorilar katalogi",
  clinic: "Klinika: shifokorlar, bemorlar qabuli",
};
