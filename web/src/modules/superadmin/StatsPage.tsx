// Super Admin bosh sahifasi: platforma holati bir qarashda — muassasalar, foydalanuvchilar, bronlar, obuna daromadi.
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { api } from "../../api/client";
import type { PlatformStats } from "../../api/types";
import { formatDate, formatMoney, shortDate } from "../../components/format";
import { Stars } from "../../components/Stars";
import { Card, Empty, ErrorNote, PageTitle, Spinner, Tabs } from "../../components/ui";
import { PAYMENT_METHODS } from "./SubscriptionPayments";

import { getLang, t } from "../../i18n";
const MONTHS = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

const compact = (v: number) =>
  Math.abs(v) >= 1_000_000 ? t("{a} mln", { a: (v / 1_000_000).toFixed(1).replace(".0", "") })
    : Math.abs(v) >= 1000 ? t("{a} ming", { a: Math.round(v / 1000) }) : String(v);

export function StatsPage() {
  const q = useQuery({ queryKey: ["superadmin", "stats"], queryFn: () => api<PlatformStats>("/superadmin/stats") });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const s = q.data!;
  return (
    <div className="space-y-4">
      <PageTitle title={t("Statistika")} hint={t("Butun platforma bo'yicha. Vaqt — Toshkent.")} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Muassasalar")} value={String(s.businesses_total)}
          sub={<span className="text-xs text-muted">{s.businesses_operational}{" "}{t("faol ·")}{" "}{s.businesses_listed}{" "}{t("ilovada")}</span>} />
        <Stat label={t("Obuna daromadi (shu oy)")} value={formatMoney(s.revenue_this_month)}
          sub={<Delta now={s.revenue_this_month} prev={s.revenue_prev_month} what={t("o'tgan oyga")} />} />
        <Stat label={t("Bronlar (30 kun)")} value={String(s.bookings_30d)}
          sub={<Delta now={s.bookings_30d} prev={s.bookings_30d_prev} what={t("oldingi 30 kunga")} />} />
        <Stat label={t("Foydalanuvchilar")} value={String(s.users_total)}
          sub={<span className="text-xs text-muted">{s.clients_total}{" "}{t("mijoz ·")}{" "}{s.staff_total}{" "}{t("xodim")}</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-medium">{t("Muassasalar holati")}</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label={t("Faol")} value={s.businesses_operational} />
            <Row label={t("To'xtatilgan (obuna)")} value={s.businesses_suspended} />
            <Row label={t("Bloklangan")} value={s.businesses_blocked} />
            <Row label={t("Ilovada ko'rinadi")} value={s.businesses_listed} />
            <Row label={t("Bugungi bronlar")} value={s.bookings_today} />
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-medium">{t("Tur bo'yicha")}</h2>
          <BarList rows={s.by_type.map((r) => ({ label: (getLang() === "ru" && r.label_ru) || r.label, value: r.count }))} format={String} empty={t("Muassasa yo'q")} />
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">{t("Reytinglar")}</h2>
          <span className="flex items-center gap-2 text-sm">
            <Stars value={s.rating_avg} />
            <span className="tabular-nums">{s.rating_avg ? s.rating_avg.toFixed(2) : "—"}</span>
            <span className="text-xs text-muted">· {s.reviews_total}{" "}{t("ta baho, 30 kunda")}{" "}{s.reviews_30d}</span>
          </span>
        </div>
        {s.rating_top.length === 0 ? <Empty>{t("Hali baho qo'yilmagan")}</Empty> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <RatingList title={t("Eng yuqori")} rows={s.rating_top} />
            <RatingList title={t("Eng past")} rows={s.rating_low} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-medium">{t("Obunasi 7 kun ichida tugaydi")}</h2>
        {s.expiring_soon.length === 0 ? <Empty>{t("Yaqin kunlarda tugaydigan obuna yo'q")}</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {s.expiring_soon.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
                <span className="min-w-0 break-words font-medium">{b.name}</span>
                <span className="text-xs text-muted">
                  {formatDate(b.subscription_ends_at)}{" "}{t("gacha")}
                  {b.owner_phone && <> · <a className="text-primary hover:underline" href={`tel:${b.owner_phone}`}>{b.owner_phone}</a></>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-medium">{t("Oxirgi 30 kun")}</h2>
        <ColumnChart
          points={s.daily.map((d) => ({ key: d.day, label: shortDate(d.day), value: d.bookings, extra: d.new_clients }))}
          valueName={t("Bronlar")} extraName={t("Yangi foydalanuvchilar")} format={String} empty={t("Bu davrda bron yo'q")} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-medium">{t("Obuna daromadi (12 oy)")}</h2>
        <ColumnChart
          points={s.revenue_monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.amount, extra: m.count }))}
          valueName={t("Daromad")} extraName={t("To'lovlar soni")} format={formatMoney} empty={t("Hali obuna to'lovi yozilmagan")} />
      </Card>

      <Card>
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{t("Oxirgi obuna to'lovlari")}</h2>
          <Link to="/superadmin" className="text-xs text-primary hover:underline">{t("Muassasalar")}</Link>
        </div>
        {s.recent_payments.length === 0 ? (
          <Empty>{t("Hali to'lov yo'q. Muassasa oynasi → Obuna bo'limida uzaytirganda summa yoziladi")}</Empty>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {s.recent_payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
                <span className="min-w-0 break-words">
                  <span className="font-medium">{p.business_name}</span>
                  {p.business_id === null && <span className="text-xs text-muted">{" "}{t("(o'chirilgan)")}</span>}
                  <span className="text-xs text-muted"> · +{p.days}{" "}{t("kun ·")}{" "}{formatDate(p.created_at)}</span>
                </span>
                <span className="tabular-nums">
                  {p.method === "free" ? t("Bepul") : formatMoney(p.amount)}
                  <span className="text-xs text-muted"> {p.method === "free" ? "" : PAYMENT_METHODS[p.method]}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RatingList({ title, rows }: { title: string; rows: PlatformStats["rating_top"] }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{title}</p>
      <ul className="divide-y divide-line text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
            <span className="min-w-0 truncate">{r.name} <span className="text-xs text-muted">· {(getLang() === "ru" && r.category_ru) || r.category}</span></span>
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
              <Stars value={r.rating_avg} size={12} /> {r.rating_avg.toFixed(1)} <span className="text-xs text-muted">({r.rating_count})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Delta({ now, prev, what }: { now: number; prev: number; what: string }) {
  if (prev === 0 && now === 0) return null;
  if (prev === 0) return <span className="text-xs text-muted">{t("oldingi davrda 0")}</span>;
  const pct = Math.round(((now - prev) / Math.abs(prev)) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${up ? "text-success" : "text-danger"}`}>
      <Icon size={13} aria-hidden /> {up ? "+" : ""}{pct}% <span className="text-muted">{what}</span>
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <Card className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-navy [overflow-wrap:anywhere] sm:text-xl">{value}</p>
      {sub && <div className="mt-1">{sub}</div>}
    </Card>
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

function BarList({ rows, empty, format }: { rows: { label: string; value: number }[]; empty: string; format: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0 || max <= 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-3">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="tabular-nums">{format(r.value)}</span>
          </div>
          <div className="h-2 rounded bg-page">
            {r.value > 0 && <div className="h-2 rounded bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

type Point = { key: string; label: string; value: number; extra: number };

// Ustunli grafik (bitta rang), kursor bilan tooltip, "Jadval" ko'rinishi ham bor
function ColumnChart({ points, valueName, extraName, format, empty }: {
  points: Point[]; valueName: string; extraName: string; format: (v: number) => string; empty: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(Math.round(e.contentRect.width), 280)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const max = Math.max(...points.map((p) => p.value), 0);
  const hasData = max > 0 || points.some((p) => p.extra > 0);

  const W = width, H = 200, top = 12, bottom = 24, left = 52;
  const plotH = H - top - bottom;
  const y = (v: number) => top + ((max - v) / (max || 1)) * plotH;
  const step = (W - left) / Math.max(points.length, 1);
  const barW = Math.max(Math.min(step - 3, 28), 1);
  const labelEvery = Math.ceil(points.length / Math.max(Math.floor((W - left) / 52), 1));
  const h = hover !== null ? points[hover] : null;

  return (
    <>
      <div className="mb-2 flex justify-end">
        <Tabs tabs={[{ id: "chart", label: t("Grafik") }, { id: "table", label: t("Jadval") }]} value={view} onChange={setView} />
      </div>
      {!hasData ? <Empty>{empty}</Empty> : view === "table" ? (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-medium">{t("Davr")}</th>
                <th className="py-2 text-right font-medium">{valueName}</th>
                <th className="py-2 text-right font-medium">{extraName}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {points.map((p) => (
                <tr key={p.key}>
                  <td className="py-1.5">{p.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{format(p.value)}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.extra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" ref={box}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img"
            aria-label={t("{a}, eng ko'pi {b}", { a: valueName, b: format(max) })} onMouseLeave={() => setHover(null)}>
            {[max, max / 2, 0].map((v, i) => (
              <g key={i}>
                <line x1={left} x2={W} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">{compact(Math.round(v))}</text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = left + i * step + (step - barW) / 2;
              return (
                <g key={p.key} onMouseEnter={() => setHover(i)}>
                  <rect x={left + i * step} y={top} width={step} height={plotH} fill="transparent" />
                  {p.value > 0 && (
                    <rect x={x} y={y(p.value)} width={barW} height={Math.max(y(0) - y(p.value), 1)} rx={Math.min(4, barW / 2)}
                      fill="var(--color-primary)" opacity={hover === null || hover === i ? 1 : 0.45} />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={left + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize={11}
                      fill="var(--color-muted)">{p.label}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {h && hover !== null && (
            <div className="pointer-events-none absolute top-0 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md"
              style={{ left: `${Math.min(((left + hover * step + step / 2) / W) * 100, 65)}%` }}>
              <p className="font-medium">{h.label}</p>
              <p>{valueName}: <span className="tabular-nums">{format(h.value)}</span></p>
              <p className="text-muted">{extraName}: {h.extra}</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
