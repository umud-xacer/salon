// Hududiy faollik va sotuv geografiyasi (061_geo_analytics.sql): ilova qaysi viloyat/tumanda ochilyapti, u yerda
// nechta muassasa ulangan, qayerda "sotuv hududi" (foydalanuvchi ko'p, salon kam). Faqat umumlashtirilgan statistika:
// xarita nuqtalari ~1 km katakda va kamida 3 ta turli qurilma bo'lgan joyda — alohida odam kuzatilmaydi.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Flame, MapPin } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

import { api, downloadFile } from "../../api/client";
import { Card, Empty, ErrorNote, Spinner } from "../../components/ui";

import { t } from "../../i18n";

type Geo = {
  days: number; region: string | null; devices: number; sessions: number; gps_share: number; pending: number;
  regions: { region: string; devices: number; sessions: number; share: number }[];
  districts: { region: string; city: string | null; district: string; devices: number; sessions: number; share: number;
    businesses: number; high_demand: boolean }[];
  points: { lat: number; lng: number; weight: number }[];
};

const UZ_CENTER: L.LatLngTuple = [41.4, 64.6];

function GeoMap({ points, focus }: { points: Geo["points"]; focus: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: false }).setView(UZ_CENTER, 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 16, attribution: "&copy; OpenStreetMap" }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const max = Math.max(1, ...points.map((p) => p.weight));
    for (const p of points) {
      const k = Math.sqrt(p.weight / max);
      L.circleMarker([p.lat, p.lng], {
        radius: 6 + 22 * k, stroke: false, fillColor: k > 0.66 ? "#dc2626" : k > 0.33 ? "#f97316" : "#1D61E7", fillOpacity: 0.45,
      }).bindTooltip(t("{a} marta ochilgan", { a: p.weight })).addTo(layer.current);
    }
    if (points.length && focus) {
      map.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as L.LatLngTuple)).pad(0.3), { maxZoom: 12 });
    } else if (!focus) {
      map.current.setView(UZ_CENTER, 6);
    }
  }, [points, focus]);
  return <div ref={el} className="h-80 w-full overflow-hidden rounded-lg border border-line" />;
}

export function GeographySection({ days }: { days: number }) {
  const [region, setRegion] = useState("");
  const [source, setSource] = useState<"all" | "gps" | "ip">("all");
  const qs = new URLSearchParams({ days: String(days), source, ...(region ? { region } : {}) });
  const q = useQuery({
    queryKey: ["analytics", "geo", qs.toString()], placeholderData: keepPreviousData,
    queryFn: () => api<Geo>(`/admin/analytics/geography?${qs}`),
  });
  // Viloyatlar ro'yxati — filtrsiz so'rovdan (tanlangan viloyatda ham dropdown to'liq qolsin)
  const all = useQuery({
    queryKey: ["analytics", "geo-regions", days],
    queryFn: () => api<Geo>(`/admin/analytics/geography?days=${days}`),
  });
  const g = q.data;
  const maxDevices = Math.max(1, ...(g?.districts.map((d) => d.devices) ?? [1]));

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-medium"><MapPin size={16} className="text-primary" aria-hidden />{t("Hududiy faollik va sotuv geografiyasi")}</h2>
          {g && <p className="text-xs text-muted">{t("{a} qurilma · {b} marta ochilgan · GPS {c}%", { a: g.devices, b: g.sessions, c: g.gps_share })}
            {g.pending > 0 && ` · ${t("{a} ta nuqta hududi aniqlanmoqda", { a: g.pending })}`}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded-lg border border-line bg-white px-2 py-1 text-sm" value={region} aria-label={t("Hudud")}
            onChange={(e) => setRegion(e.target.value)}>
            <option value="">{t("Barcha hududlar")}</option>
            {all.data?.regions.filter((r) => !["Aniqlanmagan", "Xorij"].includes(r.region)).map((r) => <option key={r.region} value={r.region}>{r.region}</option>)}
          </select>
          <select className="rounded-lg border border-line bg-white px-2 py-1 text-sm" value={source} aria-label={t("Manba")}
            onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">{t("GPS + IP")}</option>
            <option value="gps">{t("Faqat GPS")}</option>
            <option value="ip">{t("Faqat IP")}</option>
          </select>
          <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-sm hover:bg-page"
            onClick={() => void downloadFile(`/admin/analytics/geography/export?${qs}`, `hududlar-${days}kun.xlsx`)}>
            <Download size={14} aria-hidden />Excel
          </button>
        </div>
      </div>
      {q.isPending && <Spinner />}
      {q.error && <ErrorNote error={q.error} />}
      {g && (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <GeoMap points={g.points} focus={!!region} />
            <p className="mt-1 text-xs text-muted">{t("Nuqtalar ~1 km katakda, kamida 3 ta qurilma bo'lgan joyda ko'rsatiladi.")}</p>
            {!region && g.regions.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {g.regions.slice(0, 8).map((r) => (
                  <li key={r.region}>
                    <button type="button" className="flex w-full justify-between gap-2 rounded px-1 hover:bg-page" disabled={["Aniqlanmagan", "Xorij"].includes(r.region)}
                      onClick={() => setRegion(r.region)}>
                      <span className="truncate">{r.region}</span>
                      <span className="tabular-nums text-muted">{r.devices} · {r.share}%</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase text-muted">{region ? t("{a} — tumanlar", { a: region }) : t("Tumanlar reytingi")}</h3>
            {g.districts.length === 0 ? <Empty>{t("Hali ma'lumot yo'q — ilova yangi versiyasidan keyin to'planadi")}</Empty> : (
              <ul className="max-h-96 space-y-2.5 overflow-y-auto pr-1 text-sm">
                {g.districts.map((d) => (
                  <li key={`${d.region}${d.district}`}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{d.district}</span>
                        {!region && <span className="truncate text-xs text-muted">{d.region}</span>}
                        {d.high_demand && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[11px] font-medium text-orange-700">
                            <Flame size={11} aria-hidden />{t("Sotuv hududi")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {t("{a} foyd. · {b} ochilish · {c}%", { a: d.devices, b: d.sessions, c: d.share })} · <b className={d.businesses ? "text-ink" : "text-danger"}>{t("{a} muassasa", { a: d.businesses })}</b>
                      </span>
                    </div>
                    <div className="h-2 rounded bg-page">
                      <div className={`h-2 rounded ${d.high_demand ? "bg-orange-500" : "bg-primary"}`} style={{ width: `${(d.devices / maxDevices) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
