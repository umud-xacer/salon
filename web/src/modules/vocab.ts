// Muassasa ish tartibiga qarab panel yozuvlari (TZ 5-band). Tartibni Super Admin turda belgilaydi.
export type BusinessKind = "salon" | "pharmacy" | "clinic";

export interface Vocab {
  staff: string;          // bo'lim nomi
  staffOne: string;       // bitta xodim (usta)
  services: string;
  serviceOne: string;
  clients: string;
  inventory: string;
  product: string;
  calendar: string;
}

const VOCAB: Record<BusinessKind, Vocab> = {
  salon: {
    staff: "Xodimlar", staffOne: "Usta", services: "Xizmatlar", serviceOne: "Xizmat", clients: "Mijozlar",
    inventory: "Ombor", product: "Mahsulot", calendar: "Kalendar",
  },
  pharmacy: {
    staff: "Farmatsevtlar", staffOne: "Farmatsevt", services: "Xizmatlar", serviceOne: "Xizmat", clients: "Xaridorlar",
    inventory: "Dorilar va tibbiy buyumlar", product: "Dori", calendar: "Navbat",
  },
  clinic: {
    staff: "Shifokorlar", staffOne: "Shifokor", services: "Tibbiy xizmatlar", serviceOne: "Tibbiy xizmat",
    clients: "Bemorlar", inventory: "Ombor", product: "Mahsulot", calendar: "Qabullar",
  },
};

export const vocabFor = (kind: string | undefined): Vocab => VOCAB[(kind as BusinessKind) ?? "salon"] ?? VOCAB.salon;

export const KIND_LABELS: Record<BusinessKind, string> = {
  salon: "Salon: ustalar, xizmatlar, vaqtga bron",
  pharmacy: "Dorixona: farmatsevtlar, dorilar katalogi",
  clinic: "Klinika: shifokorlar, bemorlar qabuli",
};
