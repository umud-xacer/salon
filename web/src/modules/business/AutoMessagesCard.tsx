// Avtomatik xabarlar (direktor): tug'ilgan kun tabrigi, tashrifdan keyin sharh so'rash, uzoq kelmagan mijozni qaytarish.
// Xabar ilova hisobi bor mijozga push + Xabarlar bo'limiga, Telegram bog'langan bo'lsa — Telegram'ga ham ketadi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { api, json } from "../../api/client";
import { Button, Card, ErrorNote, inputClass, Spinner } from "../../components/ui";

import { t } from "../../i18n";

type Settings = {
  birthday_enabled: boolean;
  birthday_text: string | null;
  review_enabled: boolean;
  review_delay_hours: number;
  winback_enabled: boolean;
  winback_days: number;
  winback_text: string | null;
};
type Data = { settings: Settings; sent_30d: Record<"birthday" | "review" | "winback", number> };

function Row({ title, hint, on, onToggle, sent, children }: {
  title: string; hint: string; on: boolean; onToggle: (v: boolean) => void; sent: number; children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line p-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span className="flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <span className="whitespace-nowrap text-xs text-muted">{t("30 kunda: {a}", { a: sent })}</span>
      </label>
      {on && children && <div className="mt-3 grid gap-2 pl-7">{children}</div>}
    </div>
  );
}

export function AutoMessagesCard({ businessId }: { businessId: number }) {
  const queryClient = useQueryClient();
  const key = ["auto-messages", businessId];
  const url = `/businesses/${businessId}/auto-messages`;
  const data = useQuery({ queryKey: key, queryFn: () => api<Data>(url) });
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data.data) setForm(data.data.settings);
  }, [data.data]);

  const save = useMutation({
    mutationFn: (s: Settings) => api<Settings>(url, json("PUT", s)),
    onSuccess: async () => { setSaved(true); await queryClient.invalidateQueries({ queryKey: key }); },
  });

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form) save.mutate(form);
  };
  const sent = data.data?.sent_30d;

  return (
    <Card>
      <h2 className="text-sm font-medium">{t("Avtomatik xabarlar")}</h2>
      <p className="mb-3 text-xs text-muted">
        {t("Ilovadagi mijozlarga o'zi yuboriladi: push va Xabarlar bo'limi, Telegram ulangan bo'lsa — Telegram'ga ham. Kunduzi 10:00–20:00 orasida.")}
      </p>
      {data.isPending && <Spinner />}
      {data.error && <ErrorNote error={data.error} />}
      {form && (
        <form onSubmit={submit} className="grid gap-3">
          <Row title={t("Tug'ilgan kun tabrigi")} hint={t("Mijozning tug'ilgan kunida tabrik va sovg'a taklifi")}
               on={form.birthday_enabled} onToggle={(v) => set("birthday_enabled", v)} sent={sent?.birthday ?? 0}>
            <textarea className={inputClass} rows={2} maxLength={500} value={form.birthday_text ?? ""}
                      placeholder={t("Masalan: Tug'ilgan kuningiz bilan! Shu hafta barcha xizmatlarga 20% chegirma.")}
                      onChange={(e) => set("birthday_text", e.target.value)} />
          </Row>
          <Row title={t("Tashrifdan keyin sharh so'rash")} hint={t("Rahmat aytib, xizmat va ustani baholashni so'raydi")}
               on={form.review_enabled} onToggle={(v) => set("review_enabled", v)} sent={sent?.review ?? 0}>
            <label className="text-sm">{t("Qachon yuborilsin")}
              <select className={inputClass} value={form.review_delay_hours}
                      onChange={(e) => set("review_delay_hours", Number(e.target.value))}>
                <option value={0}>{t("Xizmat yakunlanishi bilan")}</option>
                {[1, 2, 3, 6, 24].map((h) => <option key={h} value={h}>{t("{a} soatdan keyin", { a: h })}</option>)}
              </select>
            </label>
          </Row>
          <Row title={t("Uzoq kelmagan mijozni qaytarish")} hint={t("Oxirgi tashrifdan keyin belgilangan kun o'tsa va yangi broni bo'lmasa — bir marta eslatma")}
               on={form.winback_enabled} onToggle={(v) => set("winback_enabled", v)} sent={sent?.winback ?? 0}>
            <label className="text-sm">{t("Necha kundan keyin")}
              <select className={inputClass} value={form.winback_days} onChange={(e) => set("winback_days", Number(e.target.value))}>
                {[30, 45, 60, 90].map((d) => <option key={d} value={d}>{t("{a} kun", { a: d })}</option>)}
              </select>
            </label>
            <textarea className={inputClass} rows={2} maxLength={500} value={form.winback_text ?? ""}
                      placeholder={t("Masalan: Sizni sog'indik! Qaytsangiz — 10% chegirma.")}
                      onChange={(e) => set("winback_text", e.target.value)} />
          </Row>
          {save.error && <ErrorNote error={save.error} />}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
            {saved && <span className="text-xs text-emerald-700">{t("Saqlandi")}</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
