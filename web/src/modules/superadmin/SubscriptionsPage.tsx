// Super Admin: obunalar nazorati — har bir muassasa qaysi tarifda, qachon tugaydi, necha kun qoldi,
// oxirgi to'lov qachon va qancha. Eng shoshilinchi (tugagan / tugashi yaqin) tepada.
// Qatorni bossangiz muassasaning Obuna oynasi ochiladi: uzaytirish, tarif, to'lovlar tarixi.
import { useQuery } from "@tanstack/react-query";
import { Phone, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../api/client";
import type { BusinessAdmin, ModuleInfo } from "../../api/types";
import { formatDate, formatMoney } from "../../components/format";
import { Badge, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner, Tabs } from "../../components/ui";
import { BUSINESSES_KEY, BusinessDialog } from "./BusinessDialogs";
import { PAYMENT_METHODS } from "./SubscriptionPayments";
import { useBillingPlans } from "./PricingPage";

import { t } from "../../i18n";

const SOON_DAYS = 7;
const DAY = 86_400_000;

type State = "blocked" | "expired" | "soon" | "active" | "unlimited";
type Filter = "all" | State;

const daysLeft = (b: BusinessAdmin) =>
  b.subscription_ends_at ? Math.ceil((new Date(b.subscription_ends_at).getTime() - Date.now()) / DAY) : null;

function stateOf(b: BusinessAdmin): State {
  if (b.status === "blocked") return "blocked";
  const d = daysLeft(b);
  if (!b.operational) return "expired";
  if (d === null) return "unlimited";
  return d <= SOON_DAYS ? "soon" : "active";
}

// Saralash: avval tugaganlar, keyin eng oz qolganlar, oxirida muddatsiz va bloklanganlar
const ORDER: Record<State, number> = { expired: 0, soon: 1, active: 2, unlimited: 3, blocked: 4 };

function StateBadge({ b }: { b: BusinessAdmin }) {
  const s = stateOf(b);
  const d = daysLeft(b);
  if (s === "blocked") return <Badge tone="red">{t("Bloklangan")}</Badge>;
  if (s === "expired") {
    return <Badge tone="red">{d !== null && d <= 0 ? t("Tugagan ({a} kun oldin)", { a: Math.abs(d) }) : t("To'xtatilgan")}</Badge>;
  }
  if (s === "unlimited") return <Badge tone="gray">{t("Muddatsiz")}</Badge>;
  return <Badge tone={s === "soon" ? "amber" : "green"}>{t("{a} kun qoldi", { a: d })}</Badge>;
}

function Stat({ label, value, tone, onClick, active }: {
  label: string; value: string | number; tone?: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-xl border bg-white p-4 text-left transition hover:border-primary ${active ? "border-primary ring-2 ring-primary/20" : "border-line"}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? "text-navy"}`}>{value}</p>
    </button>
  );
}

// ─── To'lovi yaqinlashganlar: alohida ro'yxat va tahlil ─────────────────────
type Window = "3" | "7" | "30" | "overdue";
const WINDOW_DAYS: Record<Exclude<Window, "overdue">, number> = { "3": 3, "7": 7, "30": 30 };

function Breakdown({ title, rows }: { title: string; rows: [string, number, number][] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted">{title}</p>
      {rows.length === 0 ? <p className="text-sm text-muted">—</p> : (
        <ul className="space-y-1.5 text-sm">
          {rows.map(([name, n, sum]) => (
            <li key={name}>
              <div className="flex justify-between gap-2"><span>{name}</span><span className="tabular-nums">{n} · {formatMoney(sum)}</span></div>
              <div className="mt-0.5 h-1.5 rounded-full bg-page"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function group(list: BusinessAdmin[], key: (b: BusinessAdmin) => string): [string, number, number][] {
  const m = new Map<string, [number, number]>();
  list.forEach((b) => { const k = key(b); const [n, s] = m.get(k) ?? [0, 0]; m.set(k, [n + 1, s + b.monthly_fee]); });
  return [...m.entries()].map(([k, [n, s]]) => [k, n, s] as [string, number, number]).sort((a, c) => c[1] - a[1]);
}

function UpcomingPanel({ all, onOpen }: { all: BusinessAdmin[]; onOpen: (id: number) => void }) {
  const [win, setWin] = useState<Window>("7");
  // Bloklanganlar hisobga olinmaydi: ular to'lov bilan ochilmaydi
  const live = all.filter((b) => b.status !== "blocked");
  const overdue = live.filter((b) => !b.operational && b.subscription_ends_at !== null)
    .sort((a, c) => (daysLeft(c) ?? 0) - (daysLeft(a) ?? 0));
  const within = (n: number) => live.filter((b) => b.operational && (daysLeft(b) ?? Infinity) <= n)
    .sort((a, c) => (daysLeft(a) ?? 0) - (daysLeft(c) ?? 0));
  const list = win === "overdue" ? overdue : within(WINDOW_DAYS[win]);
  const sum = list.reduce((s, b) => s + b.monthly_fee, 0);

  // Kelgusi 4 hafta: har haftada nechta obuna tugaydi va qancha tushum kutiladi
  const weeks = [0, 1, 2, 3].map((w) => {
    const items = live.filter((b) => b.operational && (() => { const d = daysLeft(b); return d !== null && d > w * 7 && d <= (w + 1) * 7; })());
    return { label: w === 0 ? t("Shu hafta") : t("{a}-hafta", { a: w + 1 }), n: items.length, sum: items.reduce((s, b) => s + b.monthly_fee, 0) };
  });
  const maxWeek = Math.max(1, ...weeks.map((w) => w.sum));

  return (
    <Card className={overdue.length || within(3).length ? "border-amber-300" : ""}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-navy">{t("To'lovi yaqinlashganlar")}</h2>
        <span className="text-xs text-muted">{t("Bloklanganlar hisobga olinmaydi")}</span>
      </div>
      <Tabs value={win} onChange={setWin} tabs={[
        { id: "3", label: t("3 kun ichida ({a})", { a: within(3).length }) },
        { id: "7", label: t("7 kun ichida ({a})", { a: within(7).length }) },
        { id: "30", label: t("30 kun ichida ({a})", { a: within(30).length }) },
        { id: "overdue", label: t("Muddati o'tgan ({a})", { a: overdue.length }) },
      ]} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-page p-3">
              <p className="text-xs text-muted">{t("Muassasalar")}</p>
              <p className="text-xl font-semibold tabular-nums text-navy">{list.length}</p>
            </div>
            <div className="rounded-lg bg-page p-3">
              <p className="text-xs text-muted">{win === "overdue" ? t("To'xtab turgan tushum / oy") : t("Kutilayotgan tushum / oy")}</p>
              <p className={`text-xl font-semibold tabular-nums ${win === "overdue" ? "text-danger" : "text-navy"}`}>{formatMoney(sum)}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted">{t("Kelgusi 4 hafta: tugaydigan obunalar")}</p>
            <ul className="space-y-1.5 text-sm">
              {weeks.map((w) => (
                <li key={w.label}>
                  <div className="flex justify-between gap-2"><span>{w.label}</span><span className="tabular-nums">{w.n} · {formatMoney(w.sum)}</span></div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-page"><div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${(w.sum / maxWeek) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Breakdown title={t("Tariflar bo'yicha")} rows={group(list, (b) => b.plan_name ?? t("Maxsus narx"))} />
        <Breakdown title={t("Muassasa turlari bo'yicha")} rows={group(list, (b) => b.type_name ?? "—")} />
      </div>

      <div className="mt-4">
        {list.length === 0 ? <Empty>{win === "overdue" ? t("Muddati o'tgan obuna yo'q") : t("Bu davrda tugaydigan obuna yo'q")}</Empty> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {list.map((b) => {
              const d = daysLeft(b) ?? 0;
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                  <button type="button" onClick={() => onOpen(b.id)} className="min-w-0 flex-1 text-left hover:underline">
                    <span className="block font-medium text-navy">{b.name}</span>
                    <span className="block text-xs text-muted">
                      {[b.owner_name, b.plan_name ?? t("Maxsus narx"), t("{a} / oy", { a: formatMoney(b.monthly_fee) })].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  {b.owner_phone && (
                    <a href={`tel:${b.owner_phone}`} className="inline-flex items-center gap-1 tabular-nums text-primary hover:underline">
                      <Phone size={14} aria-hidden /> {b.owner_phone}
                    </a>
                  )}
                  <span className="text-xs text-muted tabular-nums">{b.subscription_ends_at && formatDate(b.subscription_ends_at)}</span>
                  <Badge tone={d <= 0 ? "red" : d <= 3 ? "red" : d <= 7 ? "amber" : "green"}>
                    {d <= 0 ? t("Tugagan ({a} kun oldin)", { a: Math.abs(d) }) : d === 1 ? t("Ertaga tugaydi") : t("{a} kun qoldi", { a: d })}
                  </Badge>
                  <button type="button" onClick={() => onOpen(b.id)}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:border-primary">{t("Uzaytirish")}</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function SubscriptionsPage() {
  const businesses = useQuery({ queryKey: BUSINESSES_KEY, queryFn: () => api<BusinessAdmin[]>("/superadmin/businesses") });
  const modules = useQuery({ queryKey: ["superadmin", "modules"], queryFn: () => api<ModuleInfo[]>("/superadmin/modules") });
  const plans = useBillingPlans();
  const [filter, setFilter] = useState<Filter>("all");
  const [plan, setPlan] = useState<string>("all");          // "all" | "custom" | plan id
  const [text, setText] = useState("");
  const [openedId, setOpenedId] = useState<number | null>(null);

  const all = businesses.data ?? [];
  const counts = useMemo(() => all.reduce((m, b) => ({ ...m, [stateOf(b)]: (m[stateOf(b)] ?? 0) + 1 }),
    {} as Partial<Record<State, number>>), [all]);
  // Oylik kutilayotgan tushum: muddatli, bloklanmagan muassasalar narxi (muddatsizlar pul to'lamaydi deb hisoblanmaydi)
  const monthly = useMemo(() => all.filter((b) => b.status !== "blocked" && b.subscription_ends_at !== null)
    .reduce((s, b) => s + b.monthly_fee, 0), [all]);
  const byPlan = useMemo(() => {
    const m = new Map<string, number>();
    all.forEach((b) => m.set(b.plan_name ?? t("Maxsus narx"), (m.get(b.plan_name ?? t("Maxsus narx")) ?? 0) + 1));
    return [...m.entries()].sort((a, c) => c[1] - a[1]);
  }, [all]);

  const list = useMemo(() => {
    const q = text.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return all
      .filter((b) => filter === "all" || stateOf(b) === filter)
      .filter((b) => plan === "all" || (plan === "custom" ? b.plan_id === null : b.plan_id === Number(plan)))
      .filter((b) => !q || [b.name, b.owner_name, b.type_name, b.city].some((v) => v?.toLowerCase().includes(q))
        || (digits.length >= 3 && b.owner_phone?.includes(digits)))
      .sort((a, c) => ORDER[stateOf(a)] - ORDER[stateOf(c)] || (daysLeft(a) ?? 1e9) - (daysLeft(c) ?? 1e9));
  }, [all, filter, plan, text]);

  const opened = all.find((b) => b.id === openedId);

  if (businesses.isLoading) return <Spinner />;
  if (businesses.error) return <ErrorNote error={businesses.error} />;

  const toggle = (f: Filter) => setFilter((cur) => (cur === f ? "all" : f));

  return (
    <div className="space-y-4">
      <PageTitle title={t("Obunalar")}
        hint={t("Har bir muassasa: tarif, tugash sanasi, necha kun qoldi va oxirgi to'lov. Bossangiz — uzaytirish oynasi.")} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t("Muddati o'tgan")} value={counts.expired ?? 0} tone={counts.expired ? "text-danger" : undefined}
          onClick={() => toggle("expired")} active={filter === "expired"} />
        <Stat label={t("{a} kunda tugaydi", { a: SOON_DAYS })} value={counts.soon ?? 0} tone={counts.soon ? "text-warning" : undefined}
          onClick={() => toggle("soon")} active={filter === "soon"} />
        <Stat label={t("Faol (7 kundan ko'p qolgan)")} value={counts.active ?? 0} tone="text-success"
          onClick={() => toggle("active")} active={filter === "active"} />
        <Stat label={t("Bloklangan")} value={counts.blocked ?? 0} onClick={() => toggle("blocked")} active={filter === "blocked"} />
        <Stat label={t("Oylik kutilayotgan tushum")} value={formatMoney(monthly)} />
      </div>

      <UpcomingPanel all={all} onOpen={setOpenedId} />

      <Card>
        <p className="mb-2 text-sm font-medium">{t("Tariflar bo'yicha")}</p>
        <div className="flex flex-wrap gap-2 text-sm">
          {byPlan.map(([name, n]) => (
            <span key={name} className="rounded-full bg-page px-3 py-1">{name}: <b className="tabular-nums">{n}</b></span>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <label className="relative block min-w-[220px] flex-1">
            <span className="sr-only">{t("Qidirish")}</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input className={`${inputClass} mt-0 pl-9`} placeholder={t("Muassasa, direktor, telefon yoki shahar")}
              value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <select className={`${inputClass} mt-0 w-auto`} value={plan} onChange={(e) => setPlan(e.target.value)} aria-label={t("Tarif")}>
            <option value="all">{t("Barcha tariflar")}</option>
            {(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="custom">{t("Maxsus narx")}</option>
          </select>
        </div>
        <Tabs value={filter} onChange={setFilter} tabs={[
          { id: "all", label: t("Hammasi ({a})", { a: all.length }) },
          { id: "expired", label: t("Muddati o'tgan ({a})", { a: counts.expired ?? 0 }) },
          { id: "soon", label: t("Tugashi yaqin ({a})", { a: counts.soon ?? 0 }) },
          { id: "active", label: t("Faol ({a})", { a: counts.active ?? 0 }) },
          { id: "unlimited", label: t("Muddatsiz ({a})", { a: counts.unlimited ?? 0 }) },
          { id: "blocked", label: t("Bloklangan ({a})", { a: counts.blocked ?? 0 }) },
        ]} />
      </Card>

      {list.length === 0 ? <Empty>{t("Hech narsa topilmadi")}</Empty> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-page text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">{t("Muassasa")}</th>
                <th className="px-3 py-2 font-medium">{t("Direktor")}</th>
                <th className="px-3 py-2 font-medium">{t("Tarif")}</th>
                <th className="px-3 py-2 font-medium">{t("Tugash sanasi")}</th>
                <th className="px-3 py-2 font-medium">{t("Holat")}</th>
                <th className="px-3 py-2 font-medium">{t("Oxirgi to'lov")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("Jami to'langan")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((b) => (
                <tr key={b.id} className="cursor-pointer hover:bg-page" onClick={() => setOpenedId(b.id)}>
                  <td className="px-4 py-3">
                    <span className="block font-medium text-navy">{b.name}</span>
                    <span className="block text-xs text-muted">{[b.type_name, b.city].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="block">{b.owner_name ?? "—"}</span>
                    {b.owner_phone && (
                      <a href={`tel:${b.owner_phone}`} onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs tabular-nums text-primary hover:underline">
                        <Phone size={12} aria-hidden /> {b.owner_phone}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="block">{b.plan_name ?? t("Maxsus narx")}</span>
                    <span className="block text-xs text-muted tabular-nums">{t("{a} / oy", { a: formatMoney(b.monthly_fee) })}</span>
                  </td>
                  <td className="px-3 py-3 tabular-nums">{b.subscription_ends_at ? formatDate(b.subscription_ends_at) : "—"}</td>
                  <td className="px-3 py-3"><StateBadge b={b} /></td>
                  <td className="px-3 py-3">
                    {b.last_payment_at ? (
                      <>
                        <span className="block tabular-nums">{formatDate(b.last_payment_at)}</span>
                        <span className="block text-xs text-muted">
                          {b.last_payment_method === "free" ? t("Bepul")
                            : `${formatMoney(b.last_payment_amount ?? 0)} · ${PAYMENT_METHODS[b.last_payment_method as keyof typeof PAYMENT_METHODS] ?? b.last_payment_method}`}
                        </span>
                      </>
                    ) : <span className="text-muted">{t("Hali to'lamagan")}</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(b.paid_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {opened && modules.data && (
        <BusinessDialog key={opened.id} business={opened} modules={modules.data} initialTab="subscription"
          onClose={() => setOpenedId(null)} />
      )}
    </div>
  );
}
