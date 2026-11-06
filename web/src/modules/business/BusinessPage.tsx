// Salon sahifasi (direktor): ilovada ko'rinish holati, ma'lumot, ish vaqti, rasmlar.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { ApiError, api, json, uploadFile } from "../../api/client";
import type { BusinessHours, BusinessPhoto, BusinessProfile, Membership, Service } from "../../api/types";
import { WEEKDAYS } from "../../components/format";
import { Button, Card, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";
import { useVocab } from "../vocab";

import { t } from "../../i18n";
export function BusinessPage({ membership }: { membership: Membership }) {
  const v = useVocab();
  const b = membership.business_id;
  const profile = useQuery({ queryKey: ["biz-profile", b], queryFn: () => api<BusinessProfile>(`/businesses/${b}/profile`) });
  const hours = useQuery({ queryKey: ["biz-hours", b], queryFn: () => api<BusinessHours[]>(`/businesses/${b}/hours`) });
  const photos = useQuery({ queryKey: ["biz-photos", b], queryFn: () => api<BusinessPhoto[]>(`/businesses/${b}/photos`) });
  const services = useQuery({
    queryKey: ["services", b],
    enabled: membership.permissions.includes("services.manage"),
    queryFn: () => api<Service[]>(`/businesses/${b}/services`),
  });

  if (profile.isPending || hours.isPending || photos.isPending) return <Spinner />;
  if (profile.error) return <ErrorNote error={profile.error} />;

  const checks = [
    { ok: profile.data.lat !== null, label: t("Xaritadagi joyi"), hint: t("Super Admin belgilaydi") },
    { ok: (hours.data?.length ?? 0) > 0, label: t("Ish vaqti"), hint: t("Pastda kiriting") },
    { ok: services.data ? services.data.some((s) => s.is_active) : true, label: t("Kamida bitta xizmat"), hint: t("Xizmatlar bo'limida") },
    { ok: (photos.data?.length ?? 0) > 0, label: t("Rasm"), hint: t("Pastda yuklang") },
    { ok: profile.data.is_listed, label: t("Ilovada ochiq"), hint: t("Ma'lumotlar bo'limida yoqing") },
  ];
  const ready = checks.every((c) => c.ok);

  return (
    <>
      <PageTitle title={v.businessPage} hint={t("{a} · {b} ilovada ko'radigan ma'lumotlar", { a: profile.data.category_name, b: v.clients.toLowerCase() })} />
      <div className="space-y-4">
        <Card>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
            {ready ? <CheckCircle2 size={18} className="text-success" aria-hidden /> : <CircleAlert size={18} className="text-warning" aria-hidden />}
            {ready ? t("{a} ilovada to'liq ko'rinadi", { a: v.businessPage }) : t("Ilovada to'liq ko'rinishi uchun")}
          </h2>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                {c.ok ? <CheckCircle2 size={15} className="shrink-0 text-success" aria-hidden />
                  : <CircleAlert size={15} className="shrink-0 text-warning" aria-hidden />}
                <span>{c.label}</span>
                {!c.ok && <span className="text-xs text-muted">({c.hint})</span>}
              </li>
            ))}
          </ul>
        </Card>
        <ProfileCard businessId={b} profile={profile.data} />
        <HoursCard businessId={b} hours={hours.data ?? []}
          defaults={[profile.data.default_opens_at.slice(0, 5), profile.data.default_closes_at.slice(0, 5)]} />
        <PhotosCard businessId={b} photos={photos.data ?? []} />
      </div>
    </>
  );
}

function ProfileCard({ businessId, profile }: { businessId: number; profile: BusinessProfile }) {
  const v = useVocab();
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(profile.description ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [listed, setListed] = useState(profile.is_listed);
  const save = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/profile`, json("PATCH", {
      description: description.trim() || null, phone: phone.trim() || null, is_listed: listed,
    })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["biz-profile", businessId] }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Card>
      <h2 className="mb-3 text-sm font-medium">{t("Ma'lumotlar")}</h2>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">{v.businessPage}{" "}{t("haqida")}
          <textarea className={inputClass} rows={3} maxLength={2000} value={description}
            placeholder={t("Xizmatlar, afzalliklar, mo'ljal")} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block text-sm">{t("Telefon (")}{v.clients.toLowerCase()}{" "}{t("uchun)")}
          <input className={inputClass} type="tel" placeholder="+998 90 123 45 67" value={phone}
            onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
          {t("Ilovada ko'rinsin")}
        </label>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
          {save.isSuccess && <span className="text-sm text-success">{t("Saqlandi")}</span>}
        </div>
      </form>
    </Card>
  );
}

type Day = { open: boolean; from: string; to: string };

function HoursCard({ businessId, hours, defaults }: {
  businessId: number; hours: BusinessHours[]; defaults: [string, string];
}) {
  const v = useVocab();
  const queryClient = useQueryClient();
  const [days, setDays] = useState<Day[]>(() => Array.from({ length: 7 }, (_, i) => {
    const h = hours.find((x) => x.weekday === i + 1);
    return h ? { open: true, from: h.opens_at.slice(0, 5), to: h.closes_at.slice(0, 5) }
      : { open: hours.length === 0 && i < 6, from: defaults[0], to: defaults[1] };
  }));
  const set = (i: number, patch: Partial<Day>) => setDays(days.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const invalid = days.some((d) => d.open && d.to <= d.from);

  const save = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/hours`, json("PUT", {
      days: days.flatMap((d, i) => (d.open ? [{ weekday: i + 1, opens_at: d.from, closes_at: d.to }] : [])),
    })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["biz-hours", businessId] }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Card>
      <h2 className="text-sm font-medium">{t("Ish vaqti")}</h2>
      <p className="mb-3 text-xs text-muted">{t("Ish jadvali kiritilmagan")}{" "}{v.staffMany}{" "}{t("shu vaqt bo'yicha bron qabul qiladi")}</p>
      <form onSubmit={submit} className="space-y-2">
        {days.map((d, i) => (
          <div key={WEEKDAYS[i + 1]} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <label className="flex w-32 items-center gap-2">
              <input type="checkbox" checked={d.open} onChange={(e) => set(i, { open: e.target.checked })} />
              {WEEKDAYS[i + 1]}
            </label>
            {d.open ? (
              <span className="flex items-center gap-2">
                <input type="time" aria-label={t("{a} ochilish", { a: WEEKDAYS[i + 1] })} className="rounded-lg border border-line px-2 py-1.5"
                  value={d.from} onChange={(e) => set(i, { from: e.target.value })} />
                <span className="text-muted">–</span>
                <input type="time" aria-label={t("{a} yopilish", { a: WEEKDAYS[i + 1] })} className="rounded-lg border border-line px-2 py-1.5"
                  value={d.to} onChange={(e) => set(i, { to: e.target.value })} />
              </span>
            ) : <span className="text-muted">{t("Dam olish")}</span>}
          </div>
        ))}
        {invalid && <p className="text-sm text-danger">{t("Yopilish vaqti ochilishdan keyin bo'lishi kerak")}</p>}
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={save.isPending || invalid}>{t("Saqlash")}</Button>
          {save.isSuccess && <span className="text-sm text-success">{t("Saqlandi")}</span>}
        </div>
      </form>
    </Card>
  );
}

function PhotosCard({ businessId, photos }: { businessId: number; photos: BusinessPhoto[] }) {
  const v = useVocab();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["biz-photos", businessId] });

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadFile(`/businesses/${businessId}/photos/upload`, file);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "upload", t("Yuklab bo'lmadi")));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      await refresh();
    }
  };
  const remove = useMutation({
    mutationFn: (id: number) => api(`/businesses/${businessId}/photos/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">{t("Rasmlar")}</h2>
          <p className="text-xs text-muted">{t("Birinchi rasm ilovadagi kartochkada chiqadi. 20 tagacha, JPG, PNG yoki WEBP")}</p>
        </div>
        <Button type="button" className="flex items-center gap-1" disabled={busy || photos.length >= 20}
          onClick={() => input.current?.click()}>
          <ImagePlus size={16} aria-hidden /> {busy ? t("Yuklanmoqda...") : t("Rasm qo'shish")}
        </Button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
          onChange={(e) => void pick(e.target.files)} />
      </div>
      {(error || remove.error) && <div className="mb-3"><ErrorNote error={error ?? remove.error} /></div>}
      {photos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("Hali rasm yo'q")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.id} className="relative overflow-hidden rounded-lg border border-line">
              <img src={p.url} alt={t("{a} rasmi {b}", { a: v.businessPage, b: i + 1 })} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              {i === 0 && <span className="absolute top-1.5 left-1.5 rounded bg-navy/80 px-1.5 py-0.5 text-xs text-white">{t("Asosiy")}</span>}
              <button type="button" aria-label={t("Rasmni o'chirish")} disabled={remove.isPending}
                onClick={() => remove.mutate(p.id)}
                className="absolute top-1.5 right-1.5 rounded-full bg-white/90 p-1.5 text-danger hover:bg-white">
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
