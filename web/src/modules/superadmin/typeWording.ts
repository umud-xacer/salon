// Muassasa turiga qarab forma yozuvlari va havola (slug) qoidalari.
// Super Admin yangi tur qo'shsa (masalan, "Veterinariya"), turning o'z nomi ishlatiladi.
import type { BusinessType } from "../../api/types";

interface Wording {
  noun: string;          // "Dorixona" -> "Dorixona nomi"
  example: string;       // placeholder
  slugWord: string;      // havolaga qo'shiladigan so'z
}

const KNOWN: Record<string, Wording> = {
  beauty_salon: { noun: "Salon", example: "Masalan: Gulnora go'zallik saloni", slugWord: "salon" },
  barbershop: { noun: "Sartaroshxona", example: "Masalan: Barber House", slugWord: "barber" },
  pharmacy: { noun: "Dorixona", example: "Masalan: Shifo dorixonasi", slugWord: "dorixona" },
  clinic: { noun: "Klinika", example: "Masalan: Med Line klinikasi", slugWord: "klinika" },
  dental: { noun: "Stomatologiya", example: "Masalan: Oq Tabassum stomatologiyasi", slugWord: "stomatologiya" },
  ent: { noun: "Lor klinikasi", example: "Masalan: Sog'lom Quloq Lor klinikasi", slugWord: "lor" },
  spa: { noun: "SPA markaz", example: "Masalan: Relax SPA", slugWord: "spa" },
};

const GENERIC: Wording = { noun: "Muassasa", example: "Muassasa nomi", slugWord: "" };

export function wordingFor(type: BusinessType | undefined): Wording {
  if (!type) return GENERIC;
  return KNOWN[type.slug] ?? {
    noun: type.name_uz,
    example: `Masalan: ${type.name_uz} nomi`,
    slugWord: type.slug.replaceAll("_", "-"),
  };
}

// Kirill va o'zbek lotin harflarini havola uchun lotinga o'giradi
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ғ: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k",
  қ: "q", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ў: "o", ф: "f", х: "x",
  ҳ: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
};

export function slugify(text: string): string {
  return [...text.toLowerCase()]
    .map((ch) => CYR[ch] ?? ch)
    .join("")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")          // ü -> u, é -> e
    .replace(/['‘’ʻʼ`]/g, "")                                   // o'zbek tutuq belgisi
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/, "");
}

/** Nomdan havola: tur so'zi nomda bo'lmasa, oxiriga qo'shiladi ("shifo" -> "shifo-dorixona"). */
export function slugFor(name: string, type: BusinessType | undefined): string {
  const base = slugify(name);
  const word = wordingFor(type).slugWord;
  if (!base || !word || base.split("-").some((part) => part.startsWith(word))) return base;
  return `${base}-${word}`;
}

// Super Admin manzili turga qarab o'zbekcha: /superadmin/dorixona. Yangi turlar nomidan yasaladi.
const URLS: Record<string, string> = {
  beauty_salon: "salon", barbershop: "sartaroshxona", pharmacy: "dorixona", clinic: "klinika",
  dental: "stomatologiya", ent: "lor", spa: "wellness-spa",
};
export const RESERVED_PATHS = new Set(["turlar", "types", "t", "statistika", "tolovlar", "foydalanuvchilar", "direktorlar", "jurnal"]);

export function typeUrl(type: BusinessType): string {
  const u = URLS[type.slug] ?? (slugify(type.name_uz) || type.slug.replaceAll("_", "-"));
  return RESERVED_PATHS.has(u) ? `${u}-turi` : u;
}
