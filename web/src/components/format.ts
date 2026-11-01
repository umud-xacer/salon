const TZ = "Asia/Tashkent";

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const isoFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatDate = (iso: string) => dateFmt.format(new Date(iso)).replaceAll("/", ".");
export const todayIso = () => isoFmt.format(new Date());
export const formatMoney = (value: number) => `${value.toLocaleString("ru-RU").replaceAll(",", " ")} so'm`;

export const WEEKDAYS = ["", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];

export const STATUS_LABELS: Record<string, string> = {
  pending: "Kutilmoqda",
  confirmed: "Tasdiqlangan",
  in_progress: "Jarayonda",
  completed: "Yakunlangan",
  cancelled: "Bekor qilingan",
  no_show: "Kelmadi",
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Direktor",
  manager: "Menejer",
  receptionist: "Kassir",
  staff: "Usta",
};
