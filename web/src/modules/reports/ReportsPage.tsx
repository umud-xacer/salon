// Hisobotlar (W6): davr bo'yicha pul, bronlar, xizmatlar, xodimlar, mijozlar. Excel'ga yuklab olish.
import { useQuery } from "@tanstack/react-query";
import { Download, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, downloadFile } from "../../api/client";
import type { Membership, Report, ReportDay } from "../../api/types";
import { addDays, formatMoney, METHOD_LABELS, shortDate, STATUS_LABELS, todayIso } from "../../components/format";
import { Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner, Tabs } from "../../components/ui";
import { useVocab } from "../vocab";

import { dyn, pick, t } from "../../i18n";
type Preset = "today" | "week" | "month" | "last_month" | "custom";

const SOURCE_LABELS: Record<string, string> = { app: t("Ilova"), admin: t("Panel"), walk_in: t("O'zi kelgan"), telegram: "Telegram" };

function presetRange(p: Exclude<Preset, "custom">): [string, string] {
  const today = todayIso();
  const monthStart = `${today.slice(0, 8)}01`;
  if (p === "today") return [today, today];
  if (p === "week") return [addDays(today, -6), today];
  if (p === "month") return [monthStart, today];
  const lastEnd = addDays(monthStart, -1);
  return [`${lastEnd.slice(0, 8)}01`, lastEnd];
}

const compact = (v: number) =>
  Math.abs(v) >= 1_000_000 ? t("{a} mln", { a: (v / 1_000_000).toFixed(1).replace(".0", "") })
    : Math.abs(v) >= 1000 ? t("{a} ming", { a: Math.round(v / 1000) }) : String(v);

export function ReportsPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState<[string, string]>(presetRange("month"));
  const [from, to] = preset === "custom" ? custom : presetRange(preset);
  const valid = from <= to;
  const query = `date_from=${from}&date_to=${to}`;

  const report = useQuery({
    queryKey: ["reports", b, from, to],
    enabled: valid,
    queryFn: () => api<Report>(`/businesses/${b}/reports?${query}`),
  });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const exportExcel = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadFile(`/businesses/${b}/reports/export.xlsx?${query}`, `hisobot_${from}_${to}.xlsx`);
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageTitle
        title={t("Hisobotlar")}
        hint={t("To'lov to'langan kuniga, qaytarish qaytarilgan kuniga yoziladi. Oyliklar xarajatlar ichida.")}
        action={
          <Button variant="secondary" className="flex items-center gap-1" disabled={!report.data || exporting}
            onClick={() => void exportExcel()}>
            <Download size={16} aria-hidden /> {exporting ? t("Tayyorlanmoqda...") : t("Excel")}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Tabs
          tabs={[
            { id: "today", label: t("Bugun") }, { id: "week", label: t("7 kun") }, { id: "month", label: t("Shu oy") },
            { id: "last_month", label: t("O'tgan oy") }, { id: "custom", label: t("Tanlash") },
          ]}
          value={preset}
          onChange={(p) => {
            if (p === "custom") setCustom([from, to]);
            setPreset(p);
          }}
        />
        {preset === "custom" && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <input type="date" aria-label={t("Boshlanish sanasi")} className={`${inputClass} mt-0 w-auto`} value={custom[0]}
              max={custom[1]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
            <span className="text-muted">–</span>
            <input type="date" aria-label={t("Tugash sanasi")} className={`${inputClass} mt-0 w-auto`} value={custom[1]}
              min={custom[0]} onChange={(e) => setCustom([custom[0], e.target.value])} />
          </div>
        )}
      </div>
      {!valid && <p className="mb-3 text-sm text-danger">{t("Tugash sanasi boshlanishdan oldin bo'lmasin")}</p>}
      {exportError ? <div className="mb-3"><ErrorNote error={exportError} /></div> : null}
      {report.isPending && valid && <Spinner />}
      {report.error && <ErrorNote error={report.error} />}
      {report.data && <ReportView r={report.data} />}
    </>
  );
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return null;
  if (prev === 0) return <span className="text-xs text-muted">{t("oldingi davrda 0")}</span>;
  const pct = Math.round(((now - prev) / Math.abs(prev)) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${up ? "text-success" : "text-danger"}`}>
      <Icon size={13} aria-hidden /> {up ? "+" : ""}{pct}% <span className="text-muted">{t("oldingi davrga")}</span>
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <Card className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-navy [overflow-wrap:anywhere] sm:text-xl">{value}</p>
      {sub && <div className="mt-1">{sub}</div>}
    </Card>
  );
}

function ReportView({ r }: { r: Report }) {
  const v = useVocab();
  const m = r.money;
  const bk = r.bookings;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Sof tushum")} value={formatMoney(m.net_income)}
          sub={<Delta now={m.net_income} prev={m.prev_net_income} />} />
        <Stat label={t("Xarajatlar")} value={formatMoney(m.expenses)}
          sub={m.refunds > 0 ? <span className="text-xs text-muted">{t("Qaytarilgan: {a}", { a: formatMoney(m.refunds) })}</span> : undefined} />
        <Stat label={t("Foyda")} value={formatMoney(m.profit)} sub={<Delta now={m.profit} prev={m.prev_profit} />} />
        <Stat label={t("O'rtacha chek")} value={formatMoney(bk.avg_check)}
          sub={<span className="text-xs text-muted">{t("{a} ta bajarilgan bron", { a: bk.completed })}</span>} />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-medium">{t("Kunlik sof tushum")}</h2>
        <DailyChart days={r.daily} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-medium">{t("To'lov usullari")}</h2>
          <BarList rows={r.methods.map((x) => ({ label: METHOD_LABELS[x.method] ?? x.method, value: x.income - x.refunds }))}
            empty={t("Bu davrda to'lov yo'q")} />
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-medium">{t("Xarajatlar toifasi bo'yicha")}</h2>
          <BarList rows={r.expenses_by_category.map((x) => ({ label: dyn(x.name), value: x.amount }))}
            empty={t("Bu davrda xarajat yo'q")} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-medium">{t("Bronlar")}</h2>
          {bk.total === 0 ? <Empty>{t("Bu davrda bron yo'q")}</Empty> : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">{t("Jami")}</dt><dd className="text-right tabular-nums">{bk.total}</dd>
              {Object.entries(bk.by_status).map(([k, v]) => (
                <Row key={k} label={STATUS_LABELS[k] ?? k} value={v} />
              ))}
              <dt className="text-muted">{t("Bekor qilish ulushi")}</dt><dd className="text-right tabular-nums">{bk.cancel_rate}%</dd>
              {Object.entries(bk.by_source).map(([k, v]) => (
                <Row key={k} label={t("Manba: {a}", { a: SOURCE_LABELS[k] ?? k })} value={v} />
              ))}
            </dl>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-medium">{v.clients}</h2>
          {r.clients.total === 0 ? <Empty>{t("Bu davrda {a} yo'q", { a: v.clientOne.toLowerCase() })}</Empty> : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Row label={t("Jami (bekor qilinmagan bron bilan)")} value={r.clients.total} />
              <Row label={t("Yangi")} value={r.clients.new} />
              <Row label={t("Qaytgan")} value={r.clients.returning} />
            </dl>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-medium">{t("Xizmatlar (bajarilgan bronlar)")}</h2>
        <Table empty={t("Bu davrda bajarilgan xizmat yo'q")} head={[t("Xizmat"), t("Soni"), t("Summa")]}
          rows={r.services.map((s) => [pick(s.name, s.name_ru), s.count, formatMoney(s.revenue)])} />
      </Card>
      <Card>
        <h2 className="mb-3 text-sm font-medium">{t("Bo'limlar (bajarilgan bronlar)")}</h2>
        <Table empty={t("Bu davrda bajarilgan xizmat yo'q")} head={[t("Bo'lim"), t("Soni"), t("Summa")]}
          rows={(r.categories ?? []).map((c) => [c.name ? pick(c.name, c.name_ru) : t("Bo'limsiz"), c.count, formatMoney(c.revenue)])} />
      </Card>
      <Card>
        <h2 className="mb-3 text-sm font-medium">{t("Xodimlar")}</h2>
        <Table empty={t("Bu davrda bron yo'q")} head={[t("Xodim"), t("Bronlar"), t("Bajarilgan"), t("Kelmagan"), t("Summa")]}
          rows={r.staff.map((s) => [s.name, s.bookings, s.completed, s.no_show, formatMoney(s.revenue)])} />
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <>
    {/* Telefon: har bir qator — kartochka, ustunlar "nomi: qiymat" bo'lib */}
    <ul className="divide-y divide-line sm:hidden">
      {rows.map((r, k) => (
        <li key={k} className="py-2 text-sm">
          <p className="font-medium break-words">{r[0]}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            {r.slice(1).map((c, i) => (
              <span key={i}>{head[i + 1]}: <span className="text-ink tabular-nums">{c}</span></span>
            ))}
          </p>
        </li>
      ))}
    </ul>
    <div className="-mx-4 hidden overflow-x-auto px-4 sm:block">
      <table className="w-full min-w-[28rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            {head.map((h, i) => <th key={h} className={`py-2 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, k) => (
            <tr key={k}>
              {r.map((c, i) => (
                <td key={i} className={`py-2 ${i > 0 ? "text-right tabular-nums" : "break-words"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

// Bitta rang, uzunlik — qiymat. Matn qora (rang faqat chiziqda).
function BarList({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0 || max <= 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-3">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="tabular-nums">{formatMoney(r.value)}</span>
          </div>
          <div className="h-2 rounded bg-page">
            <div className="h-2 rounded bg-primary" style={{ width: `${Math.max((r.value / max) * 100, 1)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// Kunlik sof tushum: ustunlar, kursor bilan tooltip, "Jadval" ko'rinishi ham bor
function DailyChart({ days }: { days: ReportDay[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState<number | null>(null);
  // SVG piksel o'lchamida chiziladi: yozuvlar har qanday kenglikda 11px bo'lib qoladi
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(Math.round(e.contentRect.width), 280)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const values = useMemo(() => days.map((d) => d.income - d.refunds), [days]);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const empty = max === 0 && min === 0;

  const W = width, H = 220, top = 12, bottom = 24, left = 56;
  const plotH = H - top - bottom;
  const span = max - min || 1;
  const y = (v: number) => top + ((max - v) / span) * plotH;
  const step = (W - left) / Math.max(days.length, 1);
  const barW = Math.max(Math.min(step - 3, 20), 1);   // ustunlar orasida kamida 2px bo'shliq
  const labelEvery = Math.ceil(days.length / Math.max(Math.floor((W - left) / 56), 1));
  const h = hover !== null ? days[hover] : null;

  return (
    <>
      <div className="mb-2 flex justify-end">
        <Tabs tabs={[{ id: "chart", label: t("Grafik") }, { id: "table", label: t("Jadval") }]} value={view} onChange={setView} />
      </div>
      {view === "table" ? (
        <Table empty={t("Ma'lumot yo'q")} head={[t("Sana"), t("Tushum"), t("Qaytarilgan"), t("Xarajat"), t("Bronlar")]}
          rows={days.map((d) => [shortDate(d.date), formatMoney(d.income), formatMoney(d.refunds), formatMoney(d.expenses), d.bookings])} />
      ) : empty ? <Empty>{t("Bu davrda to'lov yo'q")}</Empty> : (
        <div className="relative" ref={box}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img"
            aria-label={t("Kunlik sof tushum, eng ko'pi {a}", { a: formatMoney(max) })} onMouseLeave={() => setHover(null)}>
            {[max, (max + min) / 2, min].map((v, i) => (
              <g key={i}>
                <line x1={left} x2={W} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">{compact(Math.round(v))}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const v = values[i];
              const x = left + i * step + (step - barW) / 2;
              const y0 = y(Math.max(v, 0)), y1 = y(Math.min(v, 0));
              return (
                <g key={d.date} onMouseEnter={() => setHover(i)}>
                  {/* Kursor uchun keng maydon */}
                  <rect x={left + i * step} y={top} width={step} height={plotH} fill="transparent" />
                  {v !== 0 && (
                    <rect x={x} y={y0} width={barW} height={Math.max(y1 - y0, 1)} rx={Math.min(4, barW / 2)}
                      fill={v < 0 ? "var(--color-danger)" : "var(--color-primary)"}
                      opacity={hover === null || hover === i ? 1 : 0.45} />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={left + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize={11}
                      fill="var(--color-muted)">{shortDate(d.date)}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {h && hover !== null && (
            <div className="pointer-events-none absolute top-0 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md"
              style={{ left: `${Math.min(((left + hover * step + step / 2) / W) * 100, 70)}%` }}>
              <p className="font-medium">{shortDate(h.date)}</p>
              <p>{t("Sof tushum:")}{" "}<span className="tabular-nums">{formatMoney(values[hover])}</span></p>
              {h.refunds > 0 && <p className="text-muted">{t("Qaytarilgan: {a}", { a: formatMoney(h.refunds) })}</p>}
              <p className="text-muted">{t("Xarajat: {a} · Bronlar: {b}", { a: formatMoney(h.expenses), b: h.bookings })}</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
