// Leaflet + OpenStreetMap. Pinlar — "★ 4,9" yorliqlari (Chronix ranglarida).
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";

export type Pin = { id: number; lat: number; lng: number; label: string; slug?: string };

export function MapView({ pins, center, active, onSelect, onMoveEnd, className = "", zoom = 12 }: {
  pins: Pin[]; center: [number, number]; active?: number | null; onSelect?: (p: Pin) => void;
  onMoveEnd?: (c: { lat: number; lng: number }) => void; className?: string; zoom?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<number, L.Marker>());
  const moveCb = useRef(onMoveEnd);
  moveCb.current = onMoveEnd;

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: true, scrollWheelZoom: true, attributionControl: true }).setView(center, zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("moveend", () => { const c = m.getCenter(); moveCb.current?.({ lat: c.lat, lng: c.lng }); });
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { map.current?.setView(center, map.current.getZoom()); }, [center[0], center[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    markers.current.clear();
    for (const p of pins) {
      const icon = L.divIcon({ className: "", html: `<span class="chx-pin" data-id="${p.id}">${p.label}</span>`, iconSize: [0, 0] });
      const mk = L.marker([p.lat, p.lng], { icon, riseOnHover: true }).addTo(g);
      mk.on("click", () => onSelect?.(p));
      markers.current.set(p.id, mk);
    }
  }, [pins, onSelect]);

  useEffect(() => {
    markers.current.forEach((mk, id) => {
      const el = mk.getElement()?.querySelector(".chx-pin");
      el?.classList.toggle("on", id === active);
      if (id === active) mk.setZIndexOffset(1000); else mk.setZIndexOffset(0);
    });
  }, [active, pins]);

  return <div ref={box} className={`z-0 ${className}`} />;
}
