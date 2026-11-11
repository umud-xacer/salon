// Shtrix-kod bilan ombor amallari — KAMERAGA BOG'LIQ BO'LMAGAN qism (TZ 2026-11-11).
// Qatlamlar:
//   1) Kamera/dekoder  — components/BarcodeScanner.tsx: faqat "kod o'qildi" (onDetected) xabarini beradi.
//   2) Mantiq (shu fayl) — kodni tozalash va API so'rovlari. DOM, React yoki brauzer kamerasi ishlatilmaydi.
//   3) Oyna            — ScanDialog.tsx: skaner -> qidiruv -> kirim/chiqim yoki yangi mahsulot.
// Mobil ilovaga ko'chirish: 1-qatlam o'rniga expo-camera (CameraView onBarcodeScanned) qo'yiladi,
// shu fayl deyarli o'zgarishsiz ko'chadi (faqat `api` importi mobile/src/api.ts ga almashadi), API bir xil.
import { api, ApiError, json } from "../../api/client";
import type { Product } from "../../api/types";

/** Baza qabul qiladigan kod: 4–64 ta harf, raqam yoki chiziqcha (products.barcode CHECK bilan bir xil) */
export const BARCODE_PATTERN = /^[0-9A-Za-z-]{4,64}$/;

/** Skaner yoki qo'lda kiritilgan matnni kodga aylantiradi. Yaroqsiz bo'lsa null (masalan, QR ichidagi havola). */
export function normalizeBarcode(raw: string): string | null {
  const code = raw.replace(/\s+/g, "");
  return BARCODE_PATTERN.test(code) ? code : null;
}

/** Kod bo'yicha mahsulot. Topilmasa null — oyna "yangi mahsulot qo'shasizmi?" deb so'raydi. */
export async function findByBarcode(businessId: number, code: string): Promise<Product | null> {
  try {
    return await api<Product>(`/businesses/${businessId}/products/by-barcode/${encodeURIComponent(code)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export type QuickMove = "purchase" | "usage";

/** Tezkor kirim yoki ombordan kamaytirish. Yangilangan mahsulotni (yangi qoldiq bilan) qaytaradi. */
export function moveStock(businessId: number, product: Product, type: QuickMove, qty: number, unitCost?: number) {
  return api<Product>(`/businesses/${businessId}/products/${product.id}/movements`, json("POST", {
    type, qty, note: null, unit_cost: type === "purchase" ? unitCost ?? product.cost_price : null,
  }));
}

export interface QuickProduct {
  barcode: string;
  name: string;
  unit: string;
  cost_price: number;
  sale_price: number;
  initial_qty: number;
}

/** Yangi mahsulot + birinchi kirim bitta so'rovda (server ikkalasini bitta tranzaksiyada saqlaydi). */
export function createScanned(businessId: number, p: QuickProduct) {
  return api<Product>(`/businesses/${businessId}/products`, json("POST", p));
}
