// Sayt sozlamalari (sql/068): chronix.uz pastki qismidagi (footer) havolalar va kontaktlar.
// Bo'sh qoldirilgan maydon saytda ko'rsatilmaydi (masalan, App Store havolasi bo'lmasa — "Tez orada").
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import { Button, Card, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";

import { t } from "../../i18n";

type Site = {
  telegram_url: string; instagram_url: string; youtube_url: string; play_url: string; appstore_url: string;
  phone: string; email: string; address_uz: string; address_ru: string;
  work_hours_uz: string; work_hours_ru: string; about_uz: string; about_ru: string;
};
type Key = keyof Site;

const URL_OK = /^https:\/\/[^\s<>"]+$/;

function Field({ k, label, form, set, placeholder, area, max }: {
  k: Key; label: string; form: Site; set: (k: Key, v: string) => void; placeholder?: string; area?: boolean; max: number;
}) {
  const v = form[k];
  const isUrl = k.endsWith("_url");
  const bad = isUrl && v.trim() !== "" && !URL_OK.test(v.trim());
  return (
    <label className="block text-sm">
      <span className="flex items-center gap-2">{label}
        {isUrl && v && !bad && (
          <a href={v} target="_blank" rel="noopener noreferrer" className="text-brand" title={t("Ochib ko'rish")}><ExternalLink size={13} /></a>
        )}
      </span>
      {area
        ? <textarea className={`${inputClass} min-h-[72px]`} maxLength={max} value={v} placeholder={placeholder}
            onChange={(e) => set(k, e.target.value)} />
        : <input className={`${inputClass} ${bad ? "border-danger" : ""}`} maxLength={max} value={v} placeholder={placeholder}
            inputMode={isUrl ? "url" : undefined} onChange={(e) => set(k, e.target.value)} />}
      {bad && <span className="text-xs text-danger">{t("Havola https:// bilan boshlanishi kerak")}</span>}
    </label>
  );
}

export function SiteSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["superadmin", "site-settings"], queryFn: () => api<Site>("/superadmin/site-settings") });
  const [form, setForm] = useState<Site | null>(null);
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: (b: Site) => api<Site>("/superadmin/site-settings", json("PUT", b)),
    onSuccess: (d) => { setForm(d); qc.setQueryData(["superadmin", "site-settings"], d); },
  });

  if (!form) return q.error ? <ErrorNote error={q.error} /> : <Spinner />;
  const set = (k: Key, v: string) => { save.reset(); setForm({ ...form, [k]: v }); };
  const changed = JSON.stringify(form) !== JSON.stringify(q.data);
  const invalid = (Object.keys(form) as Key[]).some((k) => k.endsWith("_url") && form[k].trim() && !URL_OK.test(form[k].trim()));
  const p = { form, set };
  const submit = (e: FormEvent) => { e.preventDefault(); if (!invalid) save.mutate(form); };

  return (
    <form onSubmit={submit} className="space-y-4">
      <PageTitle title={t("Sayt sozlamalari")}
        hint={t("chronix.uz pastki qismidagi (footer) havolalar va kontaktlar. Bo'sh qoldirilgan maydon saytda ko'rsatilmaydi.")} />

      <Card>
        <h2 className="mb-3 font-semibold text-navy">{t("Ijtimoiy tarmoqlar")}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Field {...p} k="telegram_url" label="Telegram" placeholder="https://t.me/..." max={300} />
          <Field {...p} k="instagram_url" label="Instagram" placeholder="https://instagram.com/..." max={300} />
          <Field {...p} k="youtube_url" label="YouTube" placeholder="https://youtube.com/@..." max={300} />
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold text-navy">{t("Mobil ilova")}</h2>
        <p className="mb-3 text-sm text-muted">{t("Havola bo'sh bo'lsa, saytda bu tugma ko'rsatilmaydi.")}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field {...p} k="play_url" label="Google Play" placeholder="https://play.google.com/store/apps/details?id=..." max={300} />
          <Field {...p} k="appstore_url" label="App Store" placeholder="https://apps.apple.com/app/..." max={300} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-navy">{t("Kontaktlar")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field {...p} k="phone" label={t("Telefon")} placeholder="+998 20 003 55 99" max={32} />
          <Field {...p} k="email" label="Email" placeholder="info@chronix.uz" max={120} />
          <Field {...p} k="address_uz" label={t("Manzil (o'zbekcha)")} max={300} />
          <Field {...p} k="address_ru" label={t("Manzil (ruscha)")} max={300} />
          <Field {...p} k="work_hours_uz" label={t("Ish vaqti (o'zbekcha)")} placeholder="Du–Sha 9:00–18:00" max={120} />
          <Field {...p} k="work_hours_ru" label={t("Ish vaqti (ruscha)")} placeholder="Пн–Сб 9:00–18:00" max={120} />
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold text-navy">{t("Qisqa ta'rif")}</h2>
        <p className="mb-3 text-sm text-muted">{t("Logotip ostidagi matn. Bo'sh bo'lsa, standart matn chiqadi.")}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field {...p} k="about_uz" label={t("O'zbekcha")} area max={400} />
          <Field {...p} k="about_ru" label={t("Ruscha")} area max={400} />
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!changed || invalid || save.isPending}>{t("Saqlash")}</Button>
        {save.isSuccess && !changed && <span className="text-sm text-success">{t("Saqlandi — saytda bir necha soniyada yangilanadi")}</span>}
        <a href="https://chronix.uz/" target="_blank" rel="noopener noreferrer" className="text-sm text-brand">{t("Saytni ochish")}</a>
      </div>
      {save.error && <ErrorNote error={save.error} />}
    </form>
  );
}
