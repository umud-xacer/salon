// Yo'nalishlar (kategoriyalar) ro'yxati — bosh sahifa, qidiruv va xarita uchun bitta manba.
// Ro'yxat hududga bog'liq emas (server tizimdagi barcha faol yo'nalishlarni beradi; mobil ilovada vaqtincha
// yashirilgan turlarni server o'zi chiqarmaydi — X-Chronix-Client). Ilgari har ekran bir marta so'rardi va xato
// bo'lsa jimgina bo'sh qolardi: internet sust bo'lgan viloyatda "Barchasi" yonida hech narsa chiqmasdi.
// Endi: oxirgi muvaffaqiyatli ro'yxat telefonda saqlanadi (darhol ko'rinadi), xato bo'lsa qayta urinadi.
import { useCallback, useEffect, useState } from 'react';

import { api, Category } from './api';
import { getItem, setItemAsync } from './secure';

const KEY = 'chronix_categories';
const RETRY_MS = [1500, 4000, 10000];

function saved(): Category[] {
  try {
    const raw = getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

let cache: Category[] = saved();
let loading: Promise<Category[]> | null = null;
const listeners = new Set<(list: Category[]) => void>();

async function fetchOnce(): Promise<Category[]> {
  const list = await api<Category[]>('/catalog/categories');
  cache = list;
  setItemAsync(KEY, JSON.stringify(list)).catch(() => {});
  listeners.forEach((l) => l(list));
  return list;
}

/** Serverdan yangilash; xato bo'lsa bir necha marta qayta urinadi. Bir vaqtda faqat bitta so'rov. */
export function refreshCategories(): Promise<Category[]> {
  loading ??= (async () => {
    try {
      for (let i = 0; ; i++) {
        try {
          return await fetchOnce();
        } catch (e) {
          if (i >= RETRY_MS.length) throw e;
          await new Promise((r) => setTimeout(r, RETRY_MS[i]));
        }
      }
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function useCategories() {
  const [list, setList] = useState<Category[]>(cache);
  useEffect(() => {
    listeners.add(setList);
    refreshCategories().catch(() => {});        // saqlangani ko'rinib turadi, fonda yangilanadi
    return () => {
      listeners.delete(setList);
    };
  }, []);
  const reload = useCallback(() => refreshCategories().catch(() => cache), []);
  return { categories: list, reload };
}
