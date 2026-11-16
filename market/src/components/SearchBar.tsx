// Uch qismli qidiruv paneli: xizmat/salon · joylashuv · kun. Har bo'lak bosilganda o'z popoveri ochiladi.
import { CalendarDays, LocateFixed, MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Category } from "../api";
import { locateMe, nextDays, setLocation, useLocation2 } from "../util";

type Part = "what" | "where" | "when" | null;

export function SearchBar({ categories, compact }: { categories: Category[]; compact?: boolean }) {
  const nav = useNavigate();
  const loc = useLocation2();
  const [open, setOpen] = useState<Part>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const days = nextDays(14);

  useEffect(() => {
    const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, []);

  const go = () => {
    const p = new URLSearchParams();
    if (cat) p.set("category", cat.slug);
    else if (q.trim().length >= 2) p.set("q", q.trim());
    if (day) p.set("day", day);
    setOpen(null);
    nav(`/qidiruv${p.toString() ? `?${p}` : ""}`);
  };

  const dayLabel = day ? (day === days[0].iso ? "Bugun" : day === days[1].iso ? "Ertaga" : `${days.find((d) => d.iso === day)?.day} ${days.find((d) => d.iso === day)?.month}`) : "Istalgan kun";
  const seg = (p: Part) => `relative flex min-w-0 flex-1 items-center gap-3 rounded-full px-5 text-left transition ${open === p ? "bg-soft shadow-inner" : "hover:bg-soft"}`;

  return (
    <div ref={box} className={`relative mx-auto w-full text-ink ${compact ? "max-w-2xl" : "max-w-4xl"}`}>
      <div className={`flex flex-col gap-1 rounded-[28px] bg-white p-1.5 shadow-[0_20px_50px_-20px_rgba(10,22,80,.45)] ring-1 ring-black/5 md:flex-row md:items-stretch md:rounded-full ${compact ? "md:h-14" : "md:h-[68px]"}`}>
        <button className={`${seg("what")} h-14 md:h-auto`} onClick={() => setOpen("what")}>
          <Search size={18} className="shrink-0 text-brand" />
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">Xizmat yoki salon</span>
            <span className="block truncate text-[15px] font-semibold">{cat?.name_uz ?? (q || "Barcha xizmatlar")}</span>
          </span>
        </button>
        <span className="hidden w-px self-center bg-line md:block md:h-8" />
        <button className={`${seg("where")} h-14 md:h-auto`} onClick={() => setOpen("where")}>
          <MapPin size={18} className="shrink-0 text-brand" />
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">Joylashuv</span>
            <span className="block truncate text-[15px] font-semibold">{loc.label}</span>
          </span>
        </button>
        <span className="hidden w-px self-center bg-line md:block md:h-8" />
        <button className={`${seg("when")} h-14 md:h-auto`} onClick={() => setOpen("when")}>
          <CalendarDays size={18} className="shrink-0 text-brand" />
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">Qachon</span>
            <span className="block truncate text-[15px] font-semibold">{dayLabel}</span>
          </span>
        </button>
        <button onClick={go} className="bg-brand-grad flex h-12 items-center justify-center gap-2 rounded-full px-7 font-bold text-white shadow-md transition hover:brightness-110 md:h-auto">
          <Search size={18} /> Qidirish
        </button>
      </div>

      {open && (
        <div className={`rise absolute z-50 mt-3 w-full rounded-3xl bg-white p-5 text-ink shadow-2xl ring-1 ring-black/5 md:w-[420px] ${open === "where" ? "md:left-1/3" : open === "when" ? "md:right-0" : "md:left-0"}`}>
          {open === "what" && (
            <div className="space-y-4">
              <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setCat(null); }} onKeyDown={(e) => e.key === "Enter" && go()}
                placeholder="Masalan: soch olish, Malika Beauty" className="h-12 w-full rounded-full border-2 border-line px-5 font-medium outline-none focus:border-brand" />
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Yo'nalishlar</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setCat(null); setQ(""); setOpen("where"); }} className={`rounded-full border px-4 py-2 text-sm font-semibold ${!cat && !q ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>Hammasi</button>
                {categories.map((c) => (
                  <button key={c.id} onClick={() => { setCat(c); setQ(""); setOpen("where"); }}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold ${cat?.id === c.id ? "border-brand bg-brand-soft text-brand" : "border-line hover:border-brand"}`}>{c.name_uz}</button>
                ))}
              </div>
            </div>
          )}
          {open === "where" && (
            <div className="space-y-2">
              <button disabled={locating} onClick={async () => { setLocating(true); try { await locateMe(); setOpen("when"); } catch { /* ruxsat yo'q */ } finally { setLocating(false); } }}
                className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-soft">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand"><LocateFixed size={18} /></span>
                <span><b className="block">{locating ? "Aniqlanmoqda…" : "Mening joylashuvim"}</b><span className="text-sm text-muted">Yaqin atrofdagi salonlar</span></span>
              </button>
              <button onClick={() => { setLocation({ lat: 41.3111, lng: 69.2797, label: "Toshkent", precise: false }); setOpen("when"); }}
                className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-soft">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-soft"><MapPin size={18} /></span>
                <span><b className="block">Toshkent</b><span className="text-sm text-muted">Butun shahar bo'yicha</span></span>
              </button>
            </div>
          )}
          {open === "when" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button onClick={() => setDay(null)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${!day ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>Istalgan kun</button>
                <button onClick={() => setDay(days[0].iso)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${day === days[0].iso ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>Bugun</button>
                <button onClick={() => setDay(days[1].iso)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${day === days[1].iso ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>Ertaga</button>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((d) => (
                  <button key={d.iso} onClick={() => setDay(d.iso)}
                    className={`flex flex-col items-center rounded-xl py-2 text-xs ${day === d.iso ? "bg-brand text-white" : "hover:bg-soft"}`}>
                    <span className={day === d.iso ? "text-white/80" : "text-muted"}>{d.wd}</span>
                    <b className="text-base">{d.day}</b>
                  </button>
                ))}
              </div>
              <button onClick={go} className="bg-brand-grad h-12 w-full rounded-full font-bold text-white">Qidirish</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
