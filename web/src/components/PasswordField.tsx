// Parol maydoni: o'ng tomonda "ko'z" — bosilsa yozilgan parol ochiq ko'rinadi (xato terishning oldini oladi).
import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";

import { t } from "../i18n";
export function PasswordField({ className = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative mt-1 block">
      <input {...props} type={shown ? "text" : "password"} className={`${className} mt-0 pr-10`} />
      <button type="button" onClick={() => setShown(!shown)}
        aria-label={shown ? t("Parolni yashirish") : t("Parolni ko'rsatish")} title={shown ? t("Yashirish") : t("Ko'rsatish")}
        className="absolute inset-y-1 right-1 flex w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
        {shown ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </span>
  );
}
