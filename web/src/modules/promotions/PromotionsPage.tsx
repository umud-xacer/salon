// Aksiyalar (direktor): bo'sh soatlarga chegirma (ilovada "Hot Slots"), promokodlar, sodiqlik dasturi.
// Chegirmani bron paytida baza hisoblaydi — bu yerda faqat qoidalar.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Gift, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { Membership, Service } from "../../api/types";
import { WEEKDAYS } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner, Tabs } from "../../components/ui";

import { t } from "../../i18n";

type Rule = {
  id: number; title: string; percent: number; weekdays: number[]; time_from: string; time_to: string;
  service_ids: number[] | null; valid_from: string; valid_to: string | null; is_active: boolean;
};
type Code = {
  id: number; code: string; title: string; percent: number; max_uses: number | null; first_visit_only: boolean;
  is_public: boolean; valid_from: string; valid_to: string | null; is_active: boolean; uses: number;
};
type Loyalty = { visits_required: number; reward_percent: number; is_active: boolean };
type Tab = "hot" | "codes" | "loyalty";

const SHORT = ["", t("Du"), t("Se"), t("Ch"), t("Pa"), t("Ju"), t("Sh"), t("Ya")];
const hm = (x: string) => x.slice(0, 5);

export function PromotionsPage({ membership }: { membership: Membership }) {
  const [tab, setTab] = useState<Tab>("hot");
  return (
    <div className="space-y-4">
      <PageTitle title={t("Aksiyalar")}
        hint={t("Mijoz ilovasida ko'rinadi. Bir bronga eng katta bitta chegirma qo'llanadi, narxni tizim o'zi hisoblaydi.")} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "hot", label: t("Bo'sh soatlarga chegirma") },
        { id: "codes", label: t("Promokodlar") },
        { id: "loyalty", label: t("Sodiqlik dasturi") },
      ]} />
      {tab === "hot" && <Rules businessId={membership.business_id} />}
      {tab === "codes" && <Codes businessId={membership.business_id} />}
      {tab === "loyalty" && <LoyaltyForm businessId={membership.business_id} />}
    </div>
  );
}

// ─── Bo'sh soatlarga chegirma ────────────────────────────────────────────────
function Rules({ businessId }: { businessId: number }) {
  const qc = useQueryClient();
  const url = `/businesses/${businessId}/promo-rules`;
  const q = useQuery({ queryKey: ["promo-rules", businessId], queryFn: () => api<Rule[]>(url) });
  const services = useQuery({ queryKey: ["services", businessId], queryFn: () => api<Service[]>(`/businesses/${businessId}/services`) });
  const [edit, setEdit] = useState<Rule | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api(`${url}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promo-rules", businessId] }),
  });
  const names = new Map((services.data ?? []).map((s) => [s.id, s.name]));

  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-amber-50 to-white">
        <div className="flex items-start gap-3">
          <Flame className="mt-0.5 text-amber-600" size={22} />
          <p className="max-w-xl text-sm text-muted">
            {t("Kam band soatlarga chegirma qo'ying (masalan, ish kunlari 10:00–12:00 da −20%). Bugungi bo'sh vaqtlar ilovaning bosh sahifasida \"Hot Slots\" bo'limida chiqadi.")}
          </p>
        </div>
        <Button onClick={() => setEdit("new")}><Plus size={16} className="mr-1 inline" />{t("Qoida qo'shish")}</Button>
      </Card>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : q.data!.length === 0 ? (
        <Empty>{t("Hozircha qoida yo'q")}</Empty>
      ) : (
        <ul className="space-y-3">
          {q.data!.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-wrap items-center gap-4">
                <span className="rounded-xl bg-amber-100 px-3 py-2 text-lg font-bold text-amber-700">−{r.percent}%</span>
                <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                  <p className="font-medium text-ink">{r.title} {!r.is_active && <Badge tone="gray">{t("O'chirilgan")}</Badge>}</p>
                  <p className="text-muted">
                    {r.weekdays.length === 7 ? t("Har kuni") : r.weekdays.map((d) => SHORT[d]).join(", ")} · {hm(r.time_from)}–{hm(r.time_to)}
                    {" · "}{r.service_ids ? r.service_ids.map((id) => names.get(id) ?? `#${id}`).join(", ") : t("Barcha xizmatlar")}
                  </p>
                  <p className="text-xs text-muted">
                    {r.valid_to ? t("{a} – {b}", { a: r.valid_from, b: r.valid_to }) : t("{a} dan muddatsiz", { a: r.valid_from })}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setEdit(r)} aria-label={t("Tahrirlash")}><Pencil size={16} /></Button>
                <Button variant="danger" aria-label={t("O'chirish")} disabled={remove.isPending}
                  onClick={() => { if (confirm(t("Qoidani o'chirasizmi?"))) remove.mutate(r.id); }}><Trash2 size={16} /></Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {edit && <RuleDialog businessId={businessId} rule={edit === "new" ? null : edit} services={services.data ?? []} onClose={() => setEdit(null)} />}
    </>
  );
}

function RuleDialog({ businessId, rule, services, onClose }: { businessId: number; rule: Rule | null; services: Service[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(rule?.title ?? t("Bo'sh soatlar"));
  const [percent, setPercent] = useState(String(rule?.percent ?? 20));
  const [days, setDays] = useState<number[]>(rule?.weekdays ?? [1, 2, 3, 4, 5]);
  const [from, setFrom] = useState(rule ? hm(rule.time_from) : "10:00");
  const [to, setTo] = useState(rule ? hm(rule.time_to) : "12:00");
  const [all, setAll] = useState(!rule?.service_ids);
  const [picked, setPicked] = useState<number[]>(rule?.service_ids ?? []);
  const [validTo, setValidTo] = useState(rule?.valid_to ?? "");
  const [active, setActive] = useState(rule?.is_active ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(), percent: Number(percent), weekdays: days, time_from: from, time_to: to,
        service_ids: all ? null : picked, valid_to: validTo || null, is_active: active,
      };
      const url = `/businesses/${businessId}/promo-rules`;
      return rule ? api(`${url}/${rule.id}`, json("PUT", body)) : api(url, json("POST", body));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["promo-rules", businessId] });
      onClose();
    },
  });
  const pct = Number(percent);
  const valid = title.trim().length >= 2 && pct >= 5 && pct <= 70 && days.length > 0 && to > from && (all || picked.length > 0);
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  return (
    <Modal title={rule ? t("Qoidani tahrirlash") : t("Yangi chegirma qoidasi")} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        <label className="block text-sm">{t("Nomi (ilovada ko'rinmaydi)")}
          <input className={inputClass} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm">{t("Chegirma, %")}
            <input className={inputClass} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/\D/g, "").slice(0, 2))} />
            <span className="text-xs text-muted">{t("5 dan 70 gacha")}</span>
          </label>
          <label className="block text-sm">{t("Boshlanishi")}
            <input type="time" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Tugashi")}
            <input type="time" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <fieldset>
          <legend className="text-sm">{t("Hafta kunlari")}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button key={d} type="button" onClick={() => setDays(toggle(days, d).sort())} aria-pressed={days.includes(d)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${days.includes(d) ? "border-primary bg-primary text-white" : "border-line bg-white"}`}>
                {WEEKDAYS[d]}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm">{t("Xizmatlar")}</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t("Barcha xizmatlar")}</label>
          {!all && (
            <div className="grid max-h-48 gap-1 overflow-auto rounded-lg border border-line p-2 sm:grid-cols-2">
              {services.filter((s) => s.is_active).map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={() => setPicked(toggle(picked, s.id))} />{s.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">{t("Amal qilish muddati (ixtiyoriy)")}
            <input type="date" className={inputClass} value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("Faol")}</label>
        </div>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{t("Saqlash")}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Promokodlar ─────────────────────────────────────────────────────────────
function Codes({ businessId }: { businessId: number }) {
  const qc = useQueryClient();
  const url = `/businesses/${businessId}/promo-codes`;
  const q = useQuery({ queryKey: ["promo-codes", businessId], queryFn: () => api<Code[]>(url) });
  const [edit, setEdit] = useState<Code | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api(`${url}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promo-codes", businessId] }),
  });

  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-violet-50 to-white">
        <div className="flex items-start gap-3">
          <Gift className="mt-0.5 text-violet-600" size={22} />
          <p className="max-w-xl text-sm text-muted">
            {t("Mijoz bronni tasdiqlashda kodni kiritadi. \"Ilovada ko'rsatish\" belgilansa, kod ilovaning bosh sahifasida \"Sizga sovg'a\" sifatida chiqadi. Har mijoz bir kodni bir marta ishlatadi.")}
          </p>
        </div>
        <Button onClick={() => setEdit("new")}><Plus size={16} className="mr-1 inline" />{t("Promokod qo'shish")}</Button>
      </Card>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : q.data!.length === 0 ? (
        <Empty>{t("Hozircha promokod yo'q")}</Empty>
      ) : (
        <ul className="space-y-3">
          {q.data!.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-wrap items-center gap-4">
                <span className="rounded-xl border-2 border-dashed border-violet-300 px-3 py-2 font-mono text-base font-bold tracking-wider text-violet-700">{c.code}</span>
                <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                  <p className="font-medium text-ink">
                    −{c.percent}% · {c.title}{" "}
                    {c.is_public && <Badge tone="green">{t("Ilovada")}</Badge>}{" "}
                    {c.first_visit_only && <Badge tone="amber">{t("Birinchi tashrif")}</Badge>}{" "}
                    {!c.is_active && <Badge tone="gray">{t("O'chirilgan")}</Badge>}
                  </p>
                  <p className="text-muted">
                    {t("Ishlatilgan: {a}", { a: c.max_uses ? `${c.uses} / ${c.max_uses}` : c.uses })}
                    {c.valid_to ? ` · ${t("{a} gacha", { a: c.valid_to })}` : ""}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setEdit(c)} aria-label={t("Tahrirlash")}><Pencil size={16} /></Button>
                <Button variant="danger" aria-label={t("O'chirish")} disabled={remove.isPending}
                  onClick={() => { if (confirm(t("Promokodni o'chirasizmi?"))) remove.mutate(c.id); }}><Trash2 size={16} /></Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {edit && <CodeDialog businessId={businessId} code={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function CodeDialog({ businessId, code, onClose }: { businessId: number; code: Code | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(code?.code ?? "");
  const [title, setTitle] = useState(code?.title ?? "");
  const [percent, setPercent] = useState(String(code?.percent ?? 10));
  const [maxUses, setMaxUses] = useState(code?.max_uses ? String(code.max_uses) : "");
  const [first, setFirst] = useState(code?.first_visit_only ?? false);
  const [pub, setPub] = useState(code?.is_public ?? false);
  const [validTo, setValidTo] = useState(code?.valid_to ?? "");
  const [active, setActive] = useState(code?.is_active ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: value, title: title.trim(), percent: Number(percent), max_uses: maxUses ? Number(maxUses) : null,
        first_visit_only: first, is_public: pub, valid_to: validTo || null, is_active: active,
      };
      const url = `/businesses/${businessId}/promo-codes`;
      return code ? api(`${url}/${code.id}`, json("PUT", body)) : api(url, json("POST", body));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["promo-codes", businessId] });
      onClose();
    },
  });
  const pct = Number(percent);
  const valid = /^[A-Z0-9]{3,20}$/.test(value) && title.trim().length >= 2 && pct >= 5 && pct <= 90;

  return (
    <Modal title={code ? t("Promokodni tahrirlash") : t("Yangi promokod")} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">{t("Kod")}
            <input className={`${inputClass} font-mono uppercase tracking-wider`} value={value} maxLength={20} data-autofocus
              placeholder="BAHOR20" onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
            <span className="text-xs text-muted">{t("Lotin harflari va raqamlar, 3–20 belgi")}</span>
          </label>
          <label className="block text-sm">{t("Chegirma, %")}
            <input className={inputClass} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/\D/g, "").slice(0, 2))} />
            <span className="text-xs text-muted">{t("5 dan 90 gacha")}</span>
          </label>
        </div>
        <label className="block text-sm">{t("Tavsif (ilovada ko'rinadi)")}
          <input className={inputClass} value={title} maxLength={80} placeholder={t("birinchi tashrifga")} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">{t("Necha marta ishlatiladi (ixtiyoriy)")}
            <input className={inputClass} inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, "").slice(0, 7))} />
          </label>
          <label className="block text-sm">{t("Amal qilish muddati (ixtiyoriy)")}
            <input type="date" className={inputClass} value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </label>
        </div>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} />{t("Ilovada ko'rsatish (\"Sizga sovg'a\")")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={first} onChange={(e) => setFirst(e.target.checked)} />{t("Faqat birinchi tashrif uchun")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("Faol")}</label>
        </div>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{t("Saqlash")}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Sodiqlik dasturi ────────────────────────────────────────────────────────
function LoyaltyForm({ businessId }: { businessId: number }) {
  const qc = useQueryClient();
  const url = `/businesses/${businessId}/loyalty`;
  const q = useQuery({ queryKey: ["loyalty", businessId], queryFn: () => api<Loyalty | null>(url) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  return <LoyaltyEditor key={JSON.stringify(q.data)} initial={q.data ?? null} onSaved={() => qc.invalidateQueries({ queryKey: ["loyalty", businessId] })} url={url} />;
}

function LoyaltyEditor({ initial, url, onSaved }: { initial: Loyalty | null; url: string; onSaved: () => void }) {
  const [visits, setVisits] = useState(String(initial?.visits_required ?? 5));
  const [percent, setPercent] = useState(String(initial?.reward_percent ?? 50));
  const [active, setActive] = useState(initial?.is_active ?? true);
  const save = useMutation({
    mutationFn: () => api(url, json("PUT", { visits_required: Number(visits), reward_percent: Number(percent), is_active: active })),
    onSuccess: onSaved,
  });
  const v = Number(visits);
  const p = Number(percent);
  const valid = v >= 2 && v <= 20 && p >= 5 && p <= 100;

  return (
    <Card className="max-w-2xl space-y-4">
      <div className="flex items-start gap-3">
        <Repeat className="mt-0.5 text-primary" size={22} />
        <p className="text-sm text-muted">
          {t("Mijoz har N ta yakunlangan tashrifdan keyin keyingi bronda chegirma oladi. Ilovada \"Tashriflar seriyasi\" ko'rinadi: nechta qolgani chiziqlarda.")}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">{t("Necha tashrifdan keyin")}
          <input className={inputClass} inputMode="numeric" value={visits} onChange={(e) => setVisits(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <span className="text-xs text-muted">{t("2 dan 20 gacha")}</span>
        </label>
        <label className="block text-sm">{t("Mukofot chegirmasi, %")}
          <input className={inputClass} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          <span className="text-xs text-muted">{t("100% — bepul xizmat")}</span>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("Dastur faol")}</label>
      {valid && (
        <p className="rounded-lg bg-page p-3 text-sm">
          {t("Misol: mijoz {a} marta kelsa, {b}-tashrifi {c}% arzon bo'ladi.", { a: v, b: v + 1, c: p })}
        </p>
      )}
      {save.error && <ErrorNote error={save.error} />}
      {save.isSuccess && <p className="text-sm text-green-700">{t("Saqlandi")}</p>}
      <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{t("Saqlash")}</Button>
    </Card>
  );
}
