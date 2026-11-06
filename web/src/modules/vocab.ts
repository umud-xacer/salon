// Muassasa ish tartibiga qarab panel yozuvlari (TZ 5-band). Tartibni Super Admin turda belgilaydi.
// Klinika va stomatologiyada "usta" emas — "shifokor". Panel ichida useVocab() bilan olinadi.
import { createContext, useContext } from "react";

import type { Membership } from "../api/types";
import { getLang, localized, t } from "../i18n";

export type BusinessKind = "salon" | "pharmacy" | "clinic";

export interface Vocab {
  staff: string;          // bo'lim nomi
  staffOne: string;       // bitta xodim (Usta / Shifokor)
  staffMany: string;      // gap ichida: "barcha ustalar" / "barcha shifokorlar"
  staffAny: string;       // "Istalgan usta"
  staffDative: string;    // "ustaga berildi"
  receptionOne: string;   // qabulxona roli: salonda "Kassir", klinikada "Registrator"
  newBooking: string;     // "Yangi bron" / "Qabulga yozish"
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
    staff: "Xodimlar", staffOne: "Usta", staffMany: "ustalar", staffAny: "Istalgan usta", staffDative: "ustaga", receptionOne: "Kassir", newBooking: "Yangi bron",
    services: "Xizmatlar", serviceOne: "Xizmat", clients: "Mijozlar", clientOne: "Mijoz",
    inventory: "Ombor", product: "Mahsulot", calendar: "Kalendar", businessPage: "Salon", place: "salon",
  },
  pharmacy: {
    staff: "Farmatsevtlar", staffOne: "Farmatsevt", staffMany: "farmatsevtlar", staffAny: "Istalgan farmatsevt",
    staffDative: "farmatsevtga", receptionOne: "Kassir", newBooking: "Navbatga yozish", services: "Xizmatlar", serviceOne: "Xizmat", clients: "Xaridorlar", clientOne: "Xaridor",
    inventory: "Dorilar va tibbiy buyumlar", product: "Dori", calendar: "Navbat", businessPage: "Dorixona", place: "dorixona",
  },
  clinic: {
    staff: "Shifokorlar", staffOne: "Shifokor", staffMany: "shifokorlar", staffAny: "Istalgan shifokor",
    staffDative: "shifokorga", receptionOne: "Registrator", newBooking: "Qabulga yozish", services: "Tibbiy xizmatlar", serviceOne: "Tibbiy xizmat",
    clients: "Bemorlar", clientOne: "Bemor", inventory: "Ombor", product: "Mahsulot", calendar: "Qabullar",
    businessPage: "Klinika", place: "klinika",
  },
};

export const vocabFor = (kind: string | undefined): Vocab => {
  const v = VOCAB[(kind as BusinessKind) ?? "salon"] ?? VOCAB.salon;
  return getLang() === "ru" ? { ...localized(v) } : v;     // ruscha: so'zlar lug'atdan (i18n/ru.ts)
};

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

/** Panel lug'ati: turga mos so'zlar + muassasa turining o'z nomi ("Stomatologiya" bo'limi, "stomatologiya ish soatlari") */
export function panelVocab(m: Pick<Membership, "business_kind" | "business_type_name" | "business_type_name_ru" | "staff_titles" | "staff_word">): Vocab {
  const v = vocabFor(m.business_kind);
  const ru = getLang() === "ru";
  const own = (ru ? m.business_type_name_ru?.trim() || m.business_type_name : m.business_type_name)?.trim();
  // Turning o'z xodim nomi (Wellness & Spa: "Mutaxassis") — rol, kalendar, "Istalgan ..."
  const w = m.staff_word?.trim();
  const lw = w?.toLowerCase();
  return {
    ...v, titles: m.staff_titles ?? [],
    ...(own ? { businessPage: own, place: own.toLowerCase() } : {}),
    ...(w && lw ? { staffOne: t(w), staffMany: t(`${lw}lar`), staffAny: t(`Istalgan ${lw}`), staffDative: t(`${lw}ga`), staff: t(`${w}lar`) } : {}),
  };
}

