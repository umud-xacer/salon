// Super Admin "Analitika": ilovani o'rnatganlar va faollik, nima qidirilyapti, qaysi tugma va bo'limlar ishlatilyapti.
// Ma'lumot o'z bazamizdan (app_events, 055_app_analytics.sql) — tashqi pullik servis yo'q.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../api/client";
import { shortDate } from "../../components/format";
import { Card, Empty, ErrorNote, PageTitle, Spinner, Tabs } from "../../components/ui";
import { GeographySection } from "./GeographySection";
import { BarList, ColumnChart, Stat } from "./StatsPage";

import { t } from "../../i18n";

type Overview = {
  days: number; users_total: number; users_new: number; clients_total: number; devices_total: number; devices_new: number;
  dau: number; wau: number; mau: number; businesses_active: number;
  daily: { day: string; new_users: number; active_users: number; active_businesses: number; bookings: number }[];
  platforms: { platform: string; users: number; events: number }[];
};
type SearchRow = { query: string; count: number; users: number; zero_results: number };
type Searches = { total: number; top: SearchRow[]; zero: SearchRow[]; categories: { category: string; count: number }[] };
type EventsStats = {
  events: { name: string; count: number; users: number }[];
  screens: { platform: string; path: string; count: number; users: number }[];
};

const PLATFORMS: Record<string, string> = {
  android: "Android", ios: "iPhone", web: t("Ilova (veb)"), market: "chronix.uz", panel: t("Biznes paneli"),
};

// Hodisa nomlari (ilova, sayt, panel kodidagi track() chaqiruvlari) — odam tushunadigan qilib
const EVENT_LABELS: Record<string, string> = {
  app_open: t("Ilovani ochdi"),
  booking_open: t("Bron oynasini ochdi"),
  booking_confirm: t("Bronni tasdiqladi"),
  booking_reschedule: t("Bron vaqtini o'zgartirdi"),
  booking_cancel: t("Bronni bekor qildi"),
  waitlist_join: t("Kutish ro'yxatiga yozildi"),
  login_open: t("Kirish oynasi ochildi"),
  login_method: t("Kirish usulini tanladi"),
  login_success: t("Tizimga kirdi"),
  favorite_toggle: t("Sevimlilarga qo'shdi/olib tashladi"),
  business_open: t("Salon sahifasini ochdi"),
  call_business: t("Salonga qo'ng'iroq qildi"),
  route_open: t("Yo'nalish (xarita) ochdi"),
  category_open: t("Yo'nalishni tanladi"),
  review_submit: t("Sharh qoldirdi"),
  promo_apply: t("Promokod kiritdi"),
  phone_confirm: t("Telefon raqamini tasdiqladi"),
  share: t("Ulashdi"),
};

export function AnalyticsPage() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [platform, setPlatform] = useState<string>("");
  const d = Number(days);
  const overview = useQuery({ queryKey: ["analytics", "overview", d], queryFn: () => api<Overview>(`/admin/analytics/overview?days=${d}`) });
  const searches = useQuery({ queryKey: ["analytics", "searches", d], queryFn: () => api<Searches>(`/admin/analytics/searches?days=${d}`) });
  const events = useQuery({
    queryKey: ["analytics", "events", d, platform],
    queryFn: () => api<EventsStats>(`/admin/analytics/events?days=${d}${platform ? `&platform=${platform}` : ""}`),
  });

  const o = overview.data;
  return (
    <div className="space-y-4">
      <PageTitle title={t("Analitika")} hint={t("Ilova, chronix.uz va biznes paneli foydalanuvchilari harakati. Vaqt — Toshkent.")}
        action={<Tabs tabs={[{ id: "7", label: t("7 kun") }, { id: "30", label: t("30 kun") }, { id: "90", label: t("90 kun") }]}
          value={days} onChange={setDays} />} />

      {overview.isLoading && <Spinner />}
      {overview.error && <ErrorNote error={overview.error} />}
      {o && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("Ro'yxatdan o'tganlar")} value={String(o.users_total)}
              sub={<span className="text-xs text-muted">{t("+{a} shu davrda · {b} mijoz", { a: o.users_new, b: o.clients_total })}</span>} />
            <Stat label={t("Ilovani o'rnatgan qurilmalar")} value={String(o.devices_total)}
              sub={<span className="text-xs text-muted">{t("+{a} yangi qurilma", { a: o.devices_new })}</span>} />
            <Stat label={t("Faol foydalanuvchilar")} value={String(o.dau)}
              sub={<span className="text-xs text-muted">{t("bugun · 7 kunda {a} · 30 kunda {b}", { a: o.wau, b: o.mau })}</span>} />
            <Stat label={t("Faol muassasalar")} value={String(o.businesses_active)}
              sub={<span className="text-xs text-muted">{t("shu davrda ish qilgan")}</span>} />
          </div>

          <Card>
            <h2 className="mb-3 text-sm font-medium">{t("Kunlik faollik")}</h2>
            <ColumnChart
              points={o.daily.map((x) => ({ key: x.day, label: shortDate(x.day), value: x.active_users, extra: x.new_users }))}
              valueName={t("Faol foydalanuvchilar")} extraName={t("Yangi ro'yxatdan o'tganlar")} format={String}
              empty={t("Hali hodisa yozilmagan — yangi ilova versiyasidan keyin to'planadi")} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 text-sm font-medium">{t("Muassasalar faolligi")}</h2>
              <ColumnChart
                points={o.daily.map((x) => ({ key: x.day, label: shortDate(x.day), value: x.active_businesses, extra: x.bookings }))}
                valueName={t("Faol muassasalar")} extraName={t("Yangi bronlar")} format={String} empty={t("Bu davrda faollik yo'q")} />
            </Card>
            <Card>
              <h2 className="mb-3 text-sm font-medium">{t("Platformalar")}</h2>
              <BarList rows={o.platforms.map((p) => ({ label: PLATFORMS[p.platform] ?? p.platform, value: p.users }))}
                format={(v) => t("{a} foyd.", { a: v })} empty={t("Hali ma'lumot yo'q")} />
            </Card>
          </div>
        </>
      )}

      <GeographySection days={d} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium">{t("Eng ko'p qidirilganlar")}</h2>
          <p className="mb-3 text-xs text-muted">{t("Jami {a} ta qidiruv", { a: searches.data?.total ?? 0 })}</p>
          {searches.isLoading && <Spinner />}
          {searches.error && <ErrorNote error={searches.error} />}
          {searches.data && <SearchTable rows={searches.data.top} empty={t("Hali qidiruv yo'q")} />}
        </Card>
        <Card>
          <h2 className="text-sm font-medium">{t("Natija bermagan qidiruvlar")}</h2>
          <p className="mb-3 text-xs text-muted">{t("Talab bor, lekin bunday salon yoki xizmat yo'q — yangi hamkor izlash uchun")}</p>
          {searches.data && <SearchTable rows={searches.data.zero} empty={t("Hammasi natija bergan")} zero />}
          {searches.data && searches.data.categories.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 text-xs font-medium uppercase text-muted">{t("Yo'nalishlar")}</h3>
              <BarList rows={searches.data.categories.map((c) => ({ label: c.category, value: c.count }))} format={String} empty="" />
            </>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t("Tugmalar va amallar")}</h2>
          <select className="rounded-lg border border-line bg-white px-2 py-1 text-sm" value={platform}
            onChange={(e) => setPlatform(e.target.value)} aria-label={t("Platforma")}>
            <option value="">{t("Barcha platformalar")}</option>
            {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {events.isLoading && <Spinner />}
        {events.error && <ErrorNote error={events.error} />}
        {events.data && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase text-muted">{t("Amallar")}</h3>
              <BarList rows={events.data.events.map((e) => ({ label: `${EVENT_LABELS[e.name] ?? e.name} · ${t("{a} foyd.", { a: e.users })}`, value: e.count }))}
                format={String} empty={t("Hali bosilgan tugma yo'q")} />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase text-muted">{t("Ekranlar va bo'limlar")}</h3>
              {events.data.screens.length === 0 ? <Empty>{t("Hali ochilgan ekran yo'q")}</Empty> : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="py-2 font-medium">{t("Bo'lim")}</th>
                      <th className="py-2 font-medium">{t("Platforma")}</th>
                      <th className="py-2 text-right font-medium">{t("Ochildi")}</th>
                      <th className="py-2 text-right font-medium">{t("Foyd.")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {events.data.screens.map((s) => (
                      <tr key={`${s.platform}${s.path}`}>
                        <td className="break-all py-1.5 font-mono text-xs">{s.path}</td>
                        <td className="py-1.5 text-xs">{PLATFORMS[s.platform] ?? s.platform}</td>
                        <td className="py-1.5 text-right tabular-nums">{s.count}</td>
                        <td className="py-1.5 text-right tabular-nums">{s.users}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function SearchTable({ rows, empty, zero }: { rows: SearchRow[]; empty: string; zero?: boolean }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs text-muted">
          <th className="py-2 font-medium">{t("So'z")}</th>
          <th className="py-2 text-right font-medium">{zero ? t("Natijasiz") : t("Marta")}</th>
          <th className="py-2 text-right font-medium">{t("Foyd.")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.query}>
            <td className="break-words py-1.5">{r.query}</td>
            <td className="py-1.5 text-right tabular-nums">{zero ? r.zero_results : r.count}</td>
            <td className="py-1.5 text-right tabular-nums">{r.users}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
