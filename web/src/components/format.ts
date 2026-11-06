import { localized, t } from "../i18n";

const TZ = "Asia/Tashkent";

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const isoFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatDate = (iso: string) => dateFmt.format(new Date(iso)).replaceAll("/", ".");
export const todayIso = () => isoFmt.format(new Date());
export const formatMoney = (value: number) => `${value.toLocaleString("ru-RU").replaceAll(",", " ")} ${t("so'm")}`;

export const dayOf = (iso: string) => isoFmt.format(new Date(iso));

/** Kun boshidan o'tgan daqiqalar (salon vaqti bo'yicha) */
export function minutesOf(iso: string) {
  const [h, m] = formatTime(iso).split(":").map(Number);
  return h * 60 + m;
}

export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const asUtc = (day: string) => new Date(`${day}T00:00:00Z`);

export const addDays = (day: string, n: number) =>
  new Date(asUtc(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** 1 = dushanba ... 7 = yakshanba */
export const weekdayOf = (day: string) => ((asUtc(day).getUTCDay() + 6) % 7) + 1;

export const mondayOf = (day: string) => addDays(day, 1 - weekdayOf(day));

export const shortDate = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

// "90 123 45 67" ham, "+998901234567" ham qabul qilinadi
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 9 ? `+998${digits}` : `+${digits}`;
}

export const WEEKDAYS = localized(["", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"]);

export const STATUS_LABELS: Record<string, string> = localized({
  pending: "Kutilmoqda",
  confirmed: "Tasdiqlangan",
  in_progress: "Jarayonda",
  completed: "Yakunlangan",
  cancelled: "Bekor qilingan",
  no_show: "Kelmadi",
});

export const formatQty = (value: number) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: 3 }).replaceAll(",", ".");

export const MOVE_LABELS: Record<string, string> = localized({
  purchase: "Kirim",
  sale: "Sotuv",
  usage: "Ishlatildi",
  to_staff: "Xodimga berildi",
  adjustment: "Sanoq",
  write_off: "Hisobdan chiqarildi",
});

export const METHOD_LABELS: Record<string, string> = localized({
  cash: "Naqd",
  card: "Karta",
  click: "Click",
  payme: "Payme",
  uzum: "Uzum",
});

export const ROLE_LABELS: Record<string, string> = localized({
  owner: "Direktor",
  manager: "Menejer",
  receptionist: "Kassir",
  staff: "Mutaxassis",          // turli muassasalar aralash joyda (Super Admin). Panel ichida — roleLabel()
});

/** 90 -> "1 soat 30 daq", 60 -> "1 soat", 45 -> "45 daq" */
export function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} ${t("soat")}` : "", m ? `${m} ${t("daq")}` : ""].filter(Boolean).join(" ") || `0 ${t("daq")}`;
}

/** Xizmat davomiyligi uchun tez tanlov */
export const DURATION_CHOICES = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240];
