// Panel tili (UZ / RU). Kalit — asl o'zbekcha matn: t("Xizmat qo'shish"). Tarjima topilmasa o'zbekcha qoladi,
// shuning uchun sahifalarni bosqichma-bosqich o'tkazish xavfsiz. Til localStorage'da saqlanadi.
// Til almashganda sahifa qayta yuklanadi — t() oddiy funksiya, hook shart emas, modul konstantalari ham yangilanadi.
import { createContext, useContext, useState, type ReactNode } from "react";

import { RU as RU_BASE } from "./ru";
import { RU_PAGES } from "./ru_pages";

const RU: Record<string, string> = { ...RU_BASE, ...RU_PAGES };

export type Lang = "uz" | "ru";
const KEY = "chronix-lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "uz" || saved === "ru") return saved;
  } catch { /* xususiy oyna */ }
  return navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "uz";
}

let current: Lang = initial();
document.documentElement.lang = current;

export const getLang = () => current;

/** Matnni joriy tilga o'giradi. {n} kabi o'rinlar vars'dan to'ldiriladi: t("{n} ta xizmat", { n: 3 }) */
export function t(uz: string, vars?: Record<string, unknown>): string {
  let s = current === "ru" ? RU[uz] ?? uz : uz;
  // null / undefined / false — bo'sh (masalan {shart && matn})
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v == null || v === false ? "" : String(v));
  return vars ? s.replace(/ {2,}/g, " ").replace(/ +$/, "") : s;
}

/** Server ma'lumoti: ruscha tilda ruscha nom (bo'lsa), aks holda o'zbekcha */
export const pick = (uz: string, ru?: string | null) => (current === "ru" && ru?.trim()) || uz;

/** Nomlar ro'yxati (bron xizmatlari): ruscha tilda ruscha ro'yxat (bo'lsa) */
export const pickList = (uz: string[], ru?: string[] | null) => (current === "ru" && ru?.length ? ru : uz);

/** Server yozgan o'zbekcha matn (lavozim tavsiyasi, "Oylik" toifasi): lug'atda bo'lsa ruscha, bo'lmasa o'zi */
export const dyn = (s?: string | null) => (s ? t(s) : "");

/** Xarajat izohi: server "Oylik: Ism, 11.2026" deb yozadi */
export const expenseNote = (s: string) => (current === "ru" ? s.replace(/^Oylik: /, `${t("Oylik")}: `) : s);

/** Qiymatlari o'zbekcha bo'lgan lug'at/massivni o'qilganda tarjima qiladi (STATUS_LABELS, WEEKDAYS...) */
export function localized<T extends object>(src: T): T {
  return new Proxy(src, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "string" ? t(v) : v;
    },
  });
}

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => {} });
export const useLang = () => useContext(LangContext);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  const setLang = (l: Lang) => {
    current = l;
    document.documentElement.lang = l;
    try { localStorage.setItem(KEY, l); } catch { /* xususiy oyna */ }
    // Modul darajasidagi yorliqlar ham yangi tilda hisoblansin — sahifa qayta yuklanadi (kirish saqlanadi)
    try { location.reload(); } catch { setState(l); }
  };
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {/* key — til almashganda hamma komponent yangi tilda qayta chiziladi */}
      <div key={lang} className="contents">{children}</div>
    </LangContext.Provider>
  );
}

export function LangSwitch({ dark = false }: { dark?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <div role="group" aria-label="Til / Язык"
      className={`inline-flex rounded-full p-0.5 text-xs font-semibold ${dark ? "bg-white/10" : "bg-page"}`}>
      {(["uz", "ru"] as const).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
          className={`rounded-full px-2.5 py-1 uppercase transition ${lang === l
            ? dark ? "bg-white text-navy" : "bg-white text-navy shadow-sm"
            : dark ? "text-white/70 hover:text-white" : "text-muted hover:text-ink"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
