/**
 * Asosiy ekran olgan oxirgi joylashuv (xotirada, ilova yopilguncha). Salon sahifasidagi "Boshqa filiallar"
 * ro'yxati shu bo'yicha eng yaqinini birinchi qo'yadi — joylashuv qayta so'ralmaydi.
 */
type Point = { latitude: number; longitude: number };

let last: Point | null = null;

export const setLastLocation = (p: Point) => { last = p; };
export const getLastLocation = () => last;

/** Ikki nuqta orasidagi masofa, metr (haversine) */
export function distanceM(a: Point, lat: number, lng: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat - a.latitude) * rad;
  const dLng = (lng - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}
