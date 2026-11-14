// Rasmni yuklashdan oldin brauzerda tayyorlash: format va hajm tekshiriladi, katta surat canvas orqali
// kichraytiriladi. Shunda sekin internetda 8 MB o'rniga ~300–500 KB ketadi va server xotirasi tejaladi.
// Yakuniy siqish (1200 px, WebP) baribir serverda — brauzerga ishonilmaydi.
import { t } from "../i18n";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");
export const MAX_IMAGE_MB = 15;

const MAX_SIDE = 2000;                    // server 1200 px ga tushiradi; zaxira bilan yuboriladi
const RESIZE_FROM_BYTES = 1024 * 1024;    // bundan kichik fayl o'z holicha ketadi

export class ImageError extends Error {}

/** Foydalanuvchiga tushunarli xato: noto'g'ri format yoki juda katta fayl */
export function checkImage(file: File): void {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new ImageError(t("{a}: faqat JPG, PNG yoki WEBP rasm yuklanadi", { a: file.name }));
  }
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
    throw new ImageError(t("{a}: rasm {b} MB dan katta ({c} MB). Kichikroq rasm tanlang", {
      a: file.name, b: MAX_IMAGE_MB, c: (file.size / 1024 / 1024).toFixed(1),
    }));
  }
}

/** Katta suratni kichraytiradi. Brauzer uddalay olmasa (eski brauzer, xotira) — asl fayl qaytadi. */
export async function shrinkImage(file: File): Promise<File> {
  if (file.size < RESIZE_FROM_BYTES || typeof createImageBitmap !== "function") return file;
  try {
    // imageOrientation: telefon surati EXIF bo'yicha to'g'ri burilgan holda chiziladi
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    // PNG shaffofligi saqlansin; qolganlari JPEG (canvas EXIF yozmaydi — joylashuv ham ketmaydi)
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    canvas.width = canvas.height = 0;     // xotirani darhol bo'shatish (Safari)
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + (type === "image/png" ? ".png" : ".jpg");
    return new File([blob], name, { type });
  } catch {
    return file;
  }
}

/** Tekshiradi va kerak bo'lsa kichraytiradi. Xato bo'lsa ImageError tashlaydi. */
export async function prepareImage(file: File): Promise<File> {
  checkImage(file);
  return shrinkImage(file);
}
