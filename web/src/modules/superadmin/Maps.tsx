// Super Admin xaritasi: Leaflet va OpenStreetMap (kalit talab qilmaydi).
// Salon nomi matn sifatida qo'yiladi, HTML emas: nomdagi kod ishga tushmaydi.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

import type { BusinessAdmin } from "../../api/types";

const TASHKENT: L.LatLngTuple = [41.3111, 69.2797];

function createMap(el: HTMLElement) {
  const map = L.map(el).setView(TASHKENT, 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  return map;
}

const color = (b: BusinessAdmin) => (b.status === "blocked" ? "#b3261e" : b.operational ? "#15803d" : "#b45309");

export function BusinessesMap({ businesses, onSelect }: {
  businesses: BusinessAdmin[];
  onSelect: (b: BusinessAdmin) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    map.current = createMap(el.current!);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
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
        .bindTooltip(label)
        .on("click", () => select.current(b))
        .addTo(layer.current);
    }
    if (points.length > 1) map.current.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    else if (points.length === 1) map.current.setView(points[0], 14);
  }, [businesses]);

  return <div ref={el} aria-label="Salonlar xaritasi" className="z-0 h-[60vh] min-h-80 rounded-xl border border-line" />;
}

export function LocationPicker({ lat, lng, onChange }: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const m = createMap(el.current!);
    map.current = m;
    m.on("click", (e: L.LeafletMouseEvent) => change.current(e.latlng.lat, e.latlng.lng));
    // Oyna ochilish paytida o'lchami tayyor emas
    const t = setTimeout(() => m.invalidateSize(), 100);
    return () => {
      clearTimeout(t);
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    if (lat === null || lng === null) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (marker.current) {
      marker.current.setLatLng([lat, lng]);
    } else {
      marker.current = L.circleMarker([lat, lng], { radius: 9, color: "#fff", weight: 2, fillColor: "#1565f5", fillOpacity: 1 }).addTo(map.current);
      map.current.setView([lat, lng], 15);
    }
  }, [lat, lng]);

  return (
    <div>
      <div ref={el} aria-label="Lokatsiyani tanlash" className="z-0 h-56 rounded-lg border border-line" />
      <p className="mt-1 text-xs text-muted tabular-nums">
        {lat !== null && lng !== null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "Xaritada salon joyini bosing"}
      </p>
    </div>
  );
}
