// Panel xaritalari: Yandex Maps JS API (server panel kalitini bersa) yoki Leaflet + OpenStreetMap (kalitsiz).
// Yandex yuklanmasa (kalit, limit, tarmoq) — avtomatik OpenStreetMap. Salon nomi matn sifatida, HTML emas.
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../api/client";
import type { BusinessAdmin } from "../../api/types";

import { t } from "../../i18n";
const TASHKENT: L.LatLngTuple = [41.3111, 69.2797];
const color = (b: BusinessAdmin) => (b.status === "blocked" ? "#b3261e" : b.operational ? "#15803d" : "#b45309");
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// ─── Yandex yuklovchi: bir marta, 12 soniyada yuklanmasa — xato ─────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
type Ymaps = any;
let ymapsPromise: Promise<Ymaps> | null = null;
function loadYmaps(key: string): Promise<Ymaps> {
  ymapsPromise ??= new Promise<Ymaps>((resolve, reject) => {
    const w = window as unknown as { ymaps?: Ymaps };
    const timer = setTimeout(() => reject(new Error("timeout")), 12_000);
    const s = document.createElement("script");
    s.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU`;
    s.async = true;
    s.onerror = () => { clearTimeout(timer); reject(new Error("load")); };
    s.onload = () => {
      if (!w.ymaps) { clearTimeout(timer); reject(new Error("no ymaps")); return; }
      w.ymaps.ready(() => { clearTimeout(timer); resolve(w.ymaps); }, () => { clearTimeout(timer); reject(new Error("ready")); });
    };
    document.head.appendChild(s);
  }).catch((e) => { ymapsPromise = null; throw e; });
  return ymapsPromise;
}

/** "yandex" | "osm" | null (aniqlanmoqda). Yandex ishlamasa — osm. */
function useProvider(): [ "yandex" | "osm" | null, Ymaps | null, () => void ] {
  const info = useQuery({
    queryKey: ["app-info"],
    queryFn: () => api<{ yandex_maps_panel_key: string | null }>("/catalog/app-info"),
    staleTime: Infinity,
  });
  const [ym, setYm] = useState<Ymaps | null>(null);
  const [failed, setFailed] = useState(false);
  const key = info.data?.yandex_maps_panel_key ?? null;
  const fail = useCallback(() => setFailed(true), []);   // barqaror: xarita qayta yaratilmasin
  useEffect(() => {
    if (!key || failed) return;
    let alive = true;
    loadYmaps(key).then((y) => alive && setYm(y)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [key, failed]);
  if (info.isPending) return [null, null, fail];
  if (!key || failed || info.isError) return ["osm", null, fail];
  return [ym ? "yandex" : null, ym, fail];
}

function createOsm(el: HTMLElement) {
  const map = L.map(el).setView(TASHKENT, 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
  return map;
}

// ─── Salonlar xaritasi ───────────────────────────────────────────────────────
type MapProps = { businesses: BusinessAdmin[]; onSelect: (b: BusinessAdmin) => void };
const MAP_CLASS = "z-0 h-[60dvh] min-h-64 rounded-xl border border-line";

export function BusinessesMap(props: MapProps) {
  const [provider, ymaps, fail] = useProvider();
  if (provider === null) return <div className={`${MAP_CLASS} animate-pulse bg-page`} aria-busy="true" />;
  return provider === "yandex" ? <YandexBusinessesMap {...props} ymaps={ymaps} onFail={fail} /> : <OsmBusinessesMap {...props} />;
}

function OsmBusinessesMap({ businesses, onSelect }: MapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    map.current = createOsm(el.current!);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const points: L.LatLngTuple[] = [];
    for (const b of businesses) {
      if (b.lat === null || b.lng === null) continue;
      const point: L.LatLngTuple = [b.lat, b.lng];
      points.push(point);
      const label = document.createElement("span");
      label.textContent = b.name;
      L.circleMarker(point, { radius: 9, color: "#fff", weight: 2, fillColor: color(b), fillOpacity: 1 })
        .bindTooltip(label).on("click", () => select.current(b)).addTo(layer.current);
    }
    if (points.length > 1) map.current.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    else if (points.length === 1) map.current.setView(points[0], 14);
  }, [businesses]);

  return <div ref={el} aria-label={t("Salonlar xaritasi")} className={MAP_CLASS} />;
}

function YandexBusinessesMap({ businesses, onSelect, ymaps, onFail }: MapProps & { ymaps: Ymaps; onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Ymaps | null>(null);
  const layer = useRef<Ymaps | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    try {
      map.current = new ymaps.Map(el.current, { center: TASHKENT, zoom: 11, controls: ["zoomControl", "typeSelector"] },
                                  { suppressMapOpenBlock: true });
      layer.current = new ymaps.GeoObjectCollection();
      map.current.geoObjects.add(layer.current);
    } catch {
      onFail();
    }
    return () => { map.current?.destroy(); map.current = null; };
  }, [ymaps, onFail]);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.removeAll();
    let count = 0;
    for (const b of businesses) {
      if (b.lat === null || b.lng === null) continue;
      count += 1;
      const mark = new ymaps.Placemark([b.lat, b.lng], { hintContent: esc(b.name) },
                                       { preset: "islands#circleDotIcon", iconColor: color(b) });
      mark.events.add("click", () => select.current(b));
      layer.current.add(mark);
    }
    if (count > 1) map.current.setBounds(layer.current.getBounds(), { checkZoomRange: true, zoomMargin: 40 });
    else if (count === 1) map.current.setCenter(layer.current.get(0).geometry.getCoordinates(), 14);
  }, [businesses, ymaps]);

  return <div ref={el} aria-label={t("Salonlar xaritasi")} className={MAP_CLASS} />;
}

// ─── Lokatsiya tanlash ───────────────────────────────────────────────────────
type PickerProps = { lat: number | null; lng: number | null; onChange: (lat: number, lng: number) => void };

export function LocationPicker(props: PickerProps) {
  const [provider, ymaps, fail] = useProvider();
  const { lat, lng } = props;
  return (
    <div>
      {provider === null && <div className="h-56 animate-pulse rounded-lg border border-line bg-page" aria-busy="true" />}
      {provider === "yandex" && <YandexPicker {...props} ymaps={ymaps} onFail={fail} />}
      {provider === "osm" && <OsmPicker {...props} />}
      <p className="mt-1 text-xs text-muted tabular-nums">
        {lat !== null && lng !== null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : t("Xaritada salon joyini bosing")}
      </p>
    </div>
  );
}

function OsmPicker({ lat, lng, onChange }: PickerProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const m = createOsm(el.current!);
    map.current = m;
    m.on("click", (e: L.LeafletMouseEvent) => change.current(e.latlng.lat, e.latlng.lng));
    const t = setTimeout(() => m.invalidateSize(), 100);          // oyna ochilish paytida o'lcham tayyor emas
    return () => { clearTimeout(t); m.remove(); map.current = null; marker.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    if (lat === null || lng === null) { marker.current?.remove(); marker.current = null; return; }
    if (marker.current) {
      marker.current.setLatLng([lat, lng]);
      if (!map.current.getBounds().contains([lat, lng])) map.current.setView([lat, lng], 15);
    } else {
      marker.current = L.circleMarker([lat, lng], { radius: 9, color: "#fff", weight: 2, fillColor: "#1565f5", fillOpacity: 1 }).addTo(map.current);
      map.current.setView([lat, lng], 15);
    }
  }, [lat, lng]);

  return <div ref={el} aria-label={t("Lokatsiyani tanlash")} className="z-0 h-56 rounded-lg border border-line" />;
}

function YandexPicker({ lat, lng, onChange, ymaps, onFail }: PickerProps & { ymaps: Ymaps; onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Ymaps | null>(null);
  const marker = useRef<Ymaps | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    try {
      const m = new ymaps.Map(el.current, { center: TASHKENT, zoom: 11, controls: ["zoomControl"] }, { suppressMapOpenBlock: true });
      // Faqat bosilgan nuqta koordinatasi olinadi (Yandex ma'lumoti saqlanmaydi)
      m.events.add("click", (e: Ymaps) => { const [a, b] = e.get("coords"); change.current(a, b); });
      map.current = m;
    } catch {
      onFail();
    }
    return () => { map.current?.destroy(); map.current = null; marker.current = null; };
  }, [ymaps, onFail]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (lat === null || lng === null) {
      if (marker.current) m.geoObjects.remove(marker.current);
      marker.current = null;
      return;
    }
    if (marker.current) marker.current.geometry.setCoordinates([lat, lng]);
    else {
      marker.current = new ymaps.Placemark([lat, lng], {}, { preset: "islands#blueDotIcon" });
      m.geoObjects.add(marker.current);
    }
    // Nuqta ko'rinib tursa xarita joyida qoladi ("Mening joyim" tashqaridagi nuqta berishi mumkin)
    if (!ymaps.util.bounds.containsPoint(m.getBounds(), [lat, lng]) || m.getZoom() < 13) {
      m.setCenter([lat, lng], 15, { duration: 200 });
    }
  }, [lat, lng, ymaps]);

  return <div ref={el} aria-label={t("Lokatsiyani tanlash")} className="z-0 h-56 rounded-lg border border-line" />;
}
