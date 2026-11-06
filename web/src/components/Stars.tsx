// Yulduzcha reyting: faqat ko'rsatish (input emas). Rang + raqam: rangni ajratolmaydiganlar ham tushunadi.
import { Star } from "lucide-react";

import { t } from "../i18n";
export function Stars({ value, size = 14, label }: { value: number | null | undefined; size?: number; label?: string }) {
  const v = value ?? 0;
  return (
    <span className="inline-flex items-center gap-0.5 align-middle" role="img"
      aria-label={`${label ? `${label}: ` : ""}${v ? v.toFixed(1) : t("baho yo'q")} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} aria-hidden strokeWidth={1.8}
          className={i <= Math.round(v) ? "fill-amber-400 text-amber-400" : "text-line"} />
      ))}
    </span>
  );
}

export const ratingText = (v: number | null | undefined, count?: number) =>
  !v ? t("Baho yo'q") : `${v.toFixed(1)}${count !== undefined ? ` (${count})` : ""}`;
