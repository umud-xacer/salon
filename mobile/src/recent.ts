// "Yaqinda ko'rilganlar": mijoz ochgan muassasalar (telefonda, oxirgi 10 tasi, eng yangisi birinchi)
import { BusinessCard, BusinessDetail } from './api';
import { getItem, setItemAsync } from './secure';

const KEY = 'chronix_recent';
const MAX = 10;

export function getRecent(): BusinessCard[] {
  try {
    const raw = getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addRecent(b: BusinessDetail, distance_m: number | null) {
  const card: BusinessCard = {
    id: b.id, slug: b.slug, name: b.name, category: b.category, category_name: b.category_name,
    category_name_ru: b.category_name_ru, city: null, address: b.address, lat: b.lat ?? 0, lng: b.lng ?? 0, distance_m,
    rating_avg: b.rating_avg, rating_count: b.rating_count, min_price: null, top_service: null, photos: b.photos.slice(0, 1),
    is_open_now: b.is_open_now, branch_name: b.branch_name,
  };
  const list = [card, ...getRecent().filter((x) => x.id !== b.id)].slice(0, MAX);
  setItemAsync(KEY, JSON.stringify(list)).catch(() => {});
}
