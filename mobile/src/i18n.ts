// Ilova tili (UZ / RU). Kalit — asl o'zbekcha matn: t('Bron qilish'). Tarjima topilmasa o'zbekcha qoladi.
// Til qurilmada saqlanadi (expo-secure-store — ilovada bor, yangi native modul shart emas) va ishga tushishda
// sinxron o'qiladi, shuning uchun modul darajasidagi yorliqlar ham to'g'ri tilda hisoblanadi.
// Til almashganda ilova qayta yuklanadi.
import * as SecureStore from './secure';
import * as Updates from 'expo-updates';
import { DevSettings } from 'react-native';

import { RU } from './i18n.ru';

export type Lang = 'uz' | 'ru';
const KEY = 'chronix_lang';

function initial(): Lang {
  try {
    const saved = SecureStore.getItem(KEY);
    if (saved === 'uz' || saved === 'ru') return saved;
  } catch {
    // saqlanmagan bo'lsa — o'zbekcha
  }
  return 'uz';
}

let current: Lang = initial();
export const getLang = () => current;

export function t(uz: string, vars?: Record<string, unknown>): string {
  let s = current === 'ru' ? RU[uz] ?? uz : uz;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v == null || v === false ? '' : String(v));
  return vars ? s.replace(/ {2,}/g, ' ').replace(/ +$/, '') : s;
}

export function localized<T extends object>(src: T): T {
  return new Proxy(src, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'string' ? t(v) : v;
    },
  });
}

export async function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    await SecureStore.setItemAsync(KEY, lang);
  } catch {
    // saqlab bo'lmasa ham joriy sessiyada ishlaydi
  }
  // Barcha ekranlar va modul yorliqlari yangi tilda — ilova qayta yuklanadi
  try {
    if (__DEV__) DevSettings.reload();
    else await Updates.reloadAsync();
  } catch {
    // qayta yuklab bo'lmasa, keyingi ochilishda yangi til
  }
}

/** Server ma'lumoti: ruscha tilda ruscha nom (bo'lsa), aks holda o'zbekcha */
export const pick = (uz: string, ru?: string | null) => (current === 'ru' && ru?.trim()) || uz;

/** Nomlar ro'yxati (bron xizmatlari): ruscha tilda ruscha ro'yxat (bo'lsa) */
export const pickList = (uz: string[], ru?: string[] | null) => (current === 'ru' && ru?.length ? ru : uz);

/** Server bildirishnomasi (o'zbekcha matn) — ruscha tilda sarlavha va oxirgi so'zlar tarjima qilinadi */
export function notificationText(title: string, body: string | null): { title: string; body: string | null } {
  if (current === 'uz') return { title, body };
  const stars = title.match(/^Yangi baho: (★+)$/);
  const tt = stars ? t('Yangi baho: {a}', { a: stars[1] }) : t(title);
  const b = body
    ?.replace(/\. Borasizmi\?$/, `. ${t('Borasizmi?')}`)
    .replace(/^Izohsiz$/, t('Izohsiz')) ?? null;
  return { title: tt, body: b };
}
