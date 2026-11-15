// Mijoz qiziqishlari (yo'nalish slug'lari): bosh sahifada shu yo'nalishlar birinchi ko'rsatiladi.
import { getItem, setItemAsync } from './secure';

const KEY = 'chronix_interests';

export function getInterests(): string[] {
  try {
    const raw = getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const setInterests = (slugs: string[]) => setItemAsync(KEY, JSON.stringify(slugs)).catch(() => {});
