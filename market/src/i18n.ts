// chronix.uz tillari (2026-11-18): o'zbekcha — chronix.uz/..., ruscha — chronix.uz/ru/...
// Til manzildan aniqlanadi (Google ikkala versiyani alohida sahifa sifatida indekslaydi, hreflang bilan bog'laydi).
// Til almashtirilganda sahifa qayta yuklanadi — shuning uchun t() modul darajasida ham ishlaydi.
// Kalit — o'zbekcha matnning o'zi: tarjima topilmasa o'zbekchasi ko'rinadi.
import { RU } from "./i18n.ru";

export type Lang = "uz" | "ru";

export const lang: Lang = typeof location !== "undefined" && /^\/ru(\/|$)/.test(location.pathname) ? "ru" : "uz";
export const BASE = lang === "ru" ? "/ru" : "";

if (typeof document !== "undefined") document.documentElement.lang = lang;

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = lang === "ru" ? RU[text] ?? text : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Bazadagi ikki tilli nom: ruscha bo'lsa — ruscha */
export const pick = (uz?: string | null, ru?: string | null) => (lang === "ru" && ru ? ru : uz ?? "");

/** Router'dan tashqari oddiy <a href> uchun (statik sahifalar emas, ilova sahifalari) */
export const href = (path: string) => `${BASE}${path === "/" && BASE ? "" : path}` || "/";

/** Shu sahifaning boshqa tildagi manzili */
export function otherLangUrl(): string {
  const plain = location.pathname.replace(/^\/ru(?=\/|$)/, "") || "/";
  const path = lang === "ru" ? plain : `/ru${plain === "/" ? "" : plain}`;
  return path + location.search + location.hash;
}
