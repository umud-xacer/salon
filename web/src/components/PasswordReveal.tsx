// Rahbar bergan boshlang'ich parolni ko'z tugmasi bilan ko'rsatish.
// Xodim va direktor parolini faqat rahbar beradi, shuning uchun u doim ko'rinadi ("issued").
import { Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { api } from "../api/client";
import type { PasswordStatus } from "../api/types";

// Tasodifiy vaqtinchalik parol: crypto, chalkashtiradigan belgilarsiz (l/1, O/0)
export function generatePassword() {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (chars: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => chars[x % chars.length]).join("");
  return pick(letters, 8) + pick(digits, 4);
}

export function PasswordReveal({ businessId, memberId, status }: {
  businessId: number;
  memberId: number | null;
  status: PasswordStatus | null;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if ((status !== "issued" && status !== "temporary") || memberId === null) return null;

  const toggle = async () => {
    if (shown) {
      setShown(null);
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ password: string | null }>(`/businesses/${businessId}/members/${memberId}/password`);
      if (r.password) setShown(r.password);
      else setNote("Parol saqlanmagan — yangisini bering");
    } catch {
      setNote("Ko'rib bo'lmadi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {shown && <code className="rounded bg-page px-1.5 py-0.5 font-mono text-ink select-all">{shown}</code>}
      {note && <span className="text-muted">{note}</span>}
      <button type="button" onClick={() => void toggle()} disabled={busy}
        aria-label={shown ? "Parolni yashirish" : "Berilgan parolni ko'rsatish"} title={shown ? "Yashirish" : "Berilgan parol"}
        className="rounded p-1 text-muted hover:bg-page hover:text-ink disabled:opacity-50">
        {shown ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
      </button>
      {shown && (
        <button type="button" aria-label="Parolni nusxalash" title="Nusxalash"
          onClick={() => { void navigator.clipboard?.writeText(shown).catch(() => {}); }}
          className="rounded p-1 text-muted hover:bg-page hover:text-ink">
          <Copy size={14} aria-hidden />
        </button>
      )}
    </span>
  );
}

/** Formadagi parol maydoni: ko'rinadigan matn, "Yaratish" tugmasi. */
export function PasswordInput({ value, onChange, required = false, label }: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  label: string;
}) {
  return (
    <label className="block text-sm">{label}
      <span className="mt-1 flex gap-2">
        <input className="w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-primary"
          required={required} minLength={8} maxLength={128} autoComplete="off" spellCheck={false}
          placeholder={required ? "" : "Bo'sh qolsa — keyin beriladi"} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => onChange(generatePassword())}
          className="shrink-0 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium hover:bg-page">
          Yaratish
        </button>
      </span>
      <span className="mt-1 block text-xs text-muted">
        Kamida 8 belgi, harf va raqam. Parolni faqat siz o'zgartirasiz, u ko'z tugmasi bilan doim ko'rinadi.
      </span>
    </label>
  );
}
