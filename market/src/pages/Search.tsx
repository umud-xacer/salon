// Qidiruv natijalari (Fresha tuzilishi): yo'nalish chiplari, kun chiplari, filtrlar oynasi, ro'yxat + xarita.
import { useQuery } from "@tanstack/react-query";
import { Map as MapIcon, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api, BusinessCard } from "../api";
import { MapView, Pin } from "../components/MapView";
import { SalonCard } from "../components/SalonCard";
import { SearchBar } from "../components/SearchBar";
import { btn, Modal, Spinner } from "../components/ui";
import { money, nextDays, useLocation2 } from "../util";
import { useCategories } from "./Home";

const SORTS = [["distance", "Eng yaqin"], ["rating", "Yuqori reyting"], ["price", "Arzonroq"]] as const;
const RADII = [2000, 5000, 10000, 25000, 50000];
const PRICES = [0, 100000, 200000, 400000, 800000];

export default function Search() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation2();
  const cats = useCategories();
  const [mapOn, setMapOn] = useState(true);
  const [mobileMap, setMobileMap] = useState(false);
  const [filters, setFilters] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [area, setArea] = useState<{ lat: number; lng: number } | null>(null);
  const days = nextDays(10);

  const category = sp.get("category") ?? "";
  const q = sp.get("q") ?? "";
  const sort = sp.get("sort") ?? "distance";
  const day = sp.get("day") ?? "";
  const radius = Number(sp.get("radius") ?? 50000);
  const maxPrice = Number(sp.get("max_price") ?? 0);
  const openNow = sp.get("open") === "1";
  const lat = Number(sp.get("lat") ?? loc.lat);
  const lng = Number(sp.get("lng") ?? loc.lng);

  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true });
  };

  const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radius_m: String(radius), sort, limit: "60" });
  if (category) params.set("category", category);
  if (q) params.set("q", q);
  if (maxPrice) params.set("max_price", String(maxPrice));
  if (openNow) params.set("open_now", "true");
  const res = useQuery({ queryKey: ["search", params.toString()], queryFn: () => api<{ items: BusinessCard[]; total: number }>(`/catalog/businesses/nearby?${params}`) });
  const items = res.data?.items ?? [];

  const pins = useMemo<Pin[]>(() => items.map((b) => ({
    id: b.id, lat: b.lat, lng: b.lng, slug: b.slug, label: b.rating_count ? `★ ${b.rating_avg.toFixed(1).replace(".", ",")}` : "Yangi",
  })), [items]);
  const onSelect = useCallback((p: Pin) => p.slug && nav(`/s/${p.slug}${day ? `?day=${day}` : ""}`), [nav, day]);
  const catName = cats.data?.find((c) => c.slug === category)?.name_uz;
  const activeFilters = (sort !== "distance" ? 1 : 0) + (radius !== 50000 ? 1 : 0) + (maxPrice ? 1 : 0) + (openNow ? 1 : 0);

  return (
    <div className="mx-auto max-w-[1600px] overflow-x-clip px-4 pb-10 sm:px-6 lg:px-8">
      <div className="py-4"><SearchBar categories={cats.data ?? []} compact /></div>

      <div className="sticky top-16 z-30 -mx-4 space-y-3 bg-white/95 px-4 py-3 backdrop-blur sm:top-[72px] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
          <button onClick={() => setFilters(true)} className={`${btn.chip} ${activeFilters ? "border-brand bg-brand-soft text-brand" : "border-line hover:border-brand"}`}>
            <SlidersHorizontal size={16} /> Filtrlar{activeFilters ? ` · ${activeFilters}` : ""}
          </button>
          <span className="h-6 w-px shrink-0 bg-line" />
          <button onClick={() => set("category", null)} className={`${btn.chip} ${!category ? "border-navy bg-navy text-white" : "border-line hover:border-brand"}`}>Hammasi</button>
          {(cats.data ?? []).map((c) => (
            <button key={c.id} onClick={() => set("category", c.slug)}
              className={`${btn.chip} ${category === c.slug ? "border-navy bg-navy text-white" : "border-line hover:border-brand"}`}>{c.name_uz}</button>
          ))}
        </div>
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-line">
          {[["", "Istalgan kun"], [days[0].iso, "Bugun"], [days[1].iso, "Ertaga"], ...days.slice(2).map((d) => [d.iso, `${d.wd} ${d.day}`])].map(([iso, label]) => (
            <button key={iso || "any"} onClick={() => set("day", iso || null)}
              className={`shrink-0 border-b-2 px-3 pb-2.5 pt-1 text-sm font-semibold transition ${day === iso ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <h1 className="text-lg font-extrabold sm:text-xl">
          {res.isLoading ? "Qidirilmoqda…" : `${res.data?.total ?? 0} ta muassasa`}
          {catName && <span className="text-muted"> · {catName}</span>}
          {q && <span className="text-muted"> · «{q}»</span>}
        </h1>
        <div className="flex gap-2">
          {q && <button onClick={() => set("q", null)} className={`${btn.chip} border-line`}><X size={14} /> {q}</button>}
          <span className="hidden lg:block">
            <button onClick={() => setMapOn((v) => !v)} className={`${btn.chip} border-line hover:border-brand`}>
              <MapIcon size={16} /> {mapOn ? "Xaritani yashirish" : "Xaritani ko'rsatish"}
            </button>
          </span>
        </div>
      </div>

      <div className={`mt-4 grid gap-6 ${mapOn ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]" : ""}`}>
        <div>
          {res.isLoading && <div className="flex justify-center py-20"><Spinner /></div>}
          {!res.isLoading && items.length === 0 && (
            <div className="rounded-3xl bg-soft p-10 text-center">
              <p className="text-lg font-bold">Hech narsa topilmadi</p>
              <p className="mt-1 text-muted">Filtrlarni o'zgartiring yoki boshqa yo'nalishni tanlang</p>
              <button onClick={() => setSp(new URLSearchParams())} className={`${btn.outline} mt-5`}>Filtrlarni tozalash</button>
            </div>
          )}
          <div className={`grid gap-x-5 gap-y-8 sm:grid-cols-2 ${mapOn ? "" : "lg:grid-cols-3 xl:grid-cols-4"}`}>
            {items.map((b) => <SalonCard key={b.id} b={b} wide onHover={setHover} />)}
          </div>
        </div>
        {mapOn && (
          <div className="relative hidden lg:block">
            <div className="sticky top-[200px] h-[calc(100vh-220px)] overflow-hidden rounded-3xl ring-1 ring-line">
              <MapView pins={pins} center={[lat, lng]} active={hover} onSelect={onSelect} onMoveEnd={setArea} className="h-full w-full" />
              {area && (Math.abs(area.lat - lat) > 0.005 || Math.abs(area.lng - lng) > 0.005) && (
                <button onClick={() => { const n = new URLSearchParams(sp); n.set("lat", area.lat.toFixed(5)); n.set("lng", area.lng.toFixed(5)); setSp(n, { replace: true }); }}
                  className="absolute left-1/2 top-4 z-[400] -translate-x-1/2 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white shadow-lg">Shu hududda qidirish</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Telefonda xarita tugmasi */}
      <button onClick={() => setMobileMap(true)} className="fixed bottom-5 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-navy px-6 py-3.5 font-bold text-white shadow-xl lg:hidden">
        <MapIcon size={18} /> Xarita
      </button>
      {mobileMap && (
        <div className="fixed inset-0 z-[900] bg-white lg:hidden">
          <MapView pins={pins} center={[lat, lng]} onSelect={onSelect} className="h-full w-full" />
          <button onClick={() => setMobileMap(false)} className="absolute right-4 top-4 z-[500] flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-lg" aria-label="Yopish"><X size={20} /></button>
        </div>
      )}

      <Modal open={filters} onClose={() => setFilters(false)} title="Filtrlar">
        <div className="space-y-7">
          <div>
            <h3 className="mb-3 font-bold">Saralash</h3>
            <div className="grid grid-cols-3 gap-2">
              {SORTS.map(([v, l]) => (
                <button key={v} onClick={() => set("sort", v === "distance" ? null : v)}
                  className={`rounded-2xl border-2 p-3 text-sm font-semibold ${sort === v ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-3 flex justify-between font-bold">Masofa <span className="font-semibold text-muted">{radius >= 50000 ? "Butun shahar" : `${radius / 1000} km gacha`}</span></h3>
            <input type="range" min={0} max={RADII.length - 1} value={RADII.indexOf(radius) < 0 ? RADII.length - 1 : RADII.indexOf(radius)}
              onChange={(e) => set("radius", RADII[+e.target.value] === 50000 ? null : String(RADII[+e.target.value]))} className="w-full accent-[#1f5bff]" />
          </div>
          <div>
            <h3 className="mb-3 flex justify-between font-bold">Narx <span className="font-semibold text-muted">{maxPrice ? `${money(maxPrice)} gacha` : "Istalgan"}</span></h3>
            <input type="range" min={0} max={PRICES.length - 1} value={Math.max(0, PRICES.indexOf(maxPrice))}
              onChange={(e) => set("max_price", PRICES[+e.target.value] ? String(PRICES[+e.target.value]) : null)} className="w-full accent-[#1f5bff]" />
          </div>
          <label className="flex items-center justify-between rounded-2xl bg-soft p-4 font-semibold">
            Faqat hozir ochiqlar
            <input type="checkbox" checked={openNow} onChange={(e) => set("open", e.target.checked ? "1" : null)} className="h-5 w-5 accent-[#1f5bff]" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button className={btn.outline} onClick={() => { const n = new URLSearchParams(); if (category) n.set("category", category); setSp(n); }}>Tozalash</button>
            <button className={btn.primary} onClick={() => setFilters(false)}>{res.data?.total ?? 0} ta ko'rsatish</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
