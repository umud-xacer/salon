// Parol maydoni: o'ng tomonda "ko'z" — bosilsa yozilgan parol ochiq ko'rinadi (xato terishning oldini oladi).
import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";

export function PasswordField({ className = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative mt-1 block">
      <input {...props} type={shown ? "text" : "password"} className={`${className} mt-0 pr-10`} />
      <button type="button" onClick={() => setShown(!shown)}
        aria-label={shown ? "Parolni yashirish" : "Parolni ko'rsatish"} title={shown ? "Yashirish" : "Ko'rsatish"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink">
        {shown ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </span>
  );
}
