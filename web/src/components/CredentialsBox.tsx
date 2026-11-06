// Kirish ma'lumotlari: Login (telefon) va Parol — ko'rish va shu yerning o'zida yangisini berish.
// Direktor xodim oynasida, Super Admin salon oynasida (direktor uchun) ishlatadi. Huquqni server tekshiradi.
import { useMutation } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../api/client";
import type { PasswordStatus } from "../api/types";
import { formatDate } from "./format";
import { PasswordInput, PasswordReveal } from "./PasswordReveal";
import { Button, ErrorNote, PasswordBadge } from "./ui";

import { t } from "../i18n";
export function CredentialsBox({ businessId, memberId, phone, status, changedAt, canView, onChanged, title }: {
  businessId: number;
  memberId: number | null;
  phone: string | null;
  status: PasswordStatus | null;
  changedAt: string | null;
  canView: boolean;                 // parolni ko'rish (Super Admin — faqat direktorniki)
  onChanged: () => unknown;         // ro'yxatni yangilash
  title: string;
}) {
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [justSet, setJustSet] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/members/${memberId}/password`, json("POST", { new_password: password })),
    onSuccess: async () => {
      setJustSet(password);
      setPassword("");
      setEditing(false);
      await onChanged();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => {}); };

  return (
    <section className="mb-3 rounded-lg border border-line bg-page px-3 py-2.5 text-sm" aria-label={title}>
      <p className="mb-1.5 text-xs font-medium text-muted">{title}</p>
      <dl className="grid grid-cols-[4.5rem_1fr] items-center gap-y-1.5">
        <dt className="text-muted">{t("Login")}</dt>
        <dd className="flex items-center gap-1">
          <span className="font-mono tabular-nums select-all">{phone ?? "—"}</span>
          {phone && (
            <button type="button" aria-label={t("Loginni nusxalash")} title={t("Nusxalash")} onClick={() => copy(phone)}
              className="rounded p-1 text-muted hover:bg-white hover:text-ink">
              <Copy size={14} aria-hidden />
            </button>
          )}
        </dd>
        <dt className="text-muted">{t("Parol")}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {justSet ? (
            <>
              <code className="rounded bg-white px-1.5 py-0.5 font-mono select-all">{justSet}</code>
              <button type="button" aria-label={t("Parolni nusxalash")} title={t("Nusxalash")} onClick={() => copy(justSet)}
                className="rounded p-1 text-muted hover:bg-white hover:text-ink">
                <Copy size={14} aria-hidden />
              </button>
              <span className="text-xs text-success">{t("Yangi parol berildi")}</span>
            </>
          ) : (
            <>
              <PasswordBadge status={status} />
              {canView && <PasswordReveal businessId={businessId} memberId={memberId} status={status} />}
              {changedAt && <span className="text-xs text-muted">{formatDate(changedAt)}</span>}
            </>
          )}
        </dd>
      </dl>
      {memberId !== null && (editing ? (
        <form onSubmit={submit} className="mt-2 space-y-2 border-t border-line pt-2">
          <PasswordInput label={t("Yangi parol")} required value={password} onChange={(v) => { setPassword(v); save.reset(); }} />
          {save.error && <ErrorNote error={save.error} />}
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
            <Button type="button" variant="secondary" onClick={() => { setEditing(false); setPassword(""); }}>{t("Bekor qilish")}</Button>
          </div>
          <p className="text-xs text-muted">{t("Saqlangach eski parol ishlamaydi va barcha qurilmalardagi kirishlar yopiladi.")}</p>
        </form>
      ) : (
        <button type="button" onClick={() => { setEditing(true); setJustSet(null); }}
          className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <KeyRound size={14} aria-hidden /> {status === "none" ? t("Parol berish") : t("Yangi parol berish")}
        </button>
      ))}
    </section>
  );
}
