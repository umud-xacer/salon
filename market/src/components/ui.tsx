import { ChevronLeft, ChevronRight, Star, X } from "lucide-react";
import { ReactNode, useEffect, useRef } from "react";
import { t } from "../i18n";

export const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 h-12 text-[15px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(31,91,255,.7)] transition hover:bg-brand-dark active:scale-[.98] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none",
  dark: "inline-flex items-center justify-center gap-2 rounded-full bg-navy px-6 h-12 text-[15px] font-bold text-white transition hover:bg-navy-2 active:scale-[.98] disabled:opacity-40",
  outline: "inline-flex items-center justify-center gap-2 rounded-full border border-line bg-white px-6 h-12 text-[15px] font-bold text-ink transition hover:border-brand hover:text-brand active:scale-[.98] disabled:opacity-40",
  soft: "inline-flex items-center justify-center gap-2 rounded-full bg-soft px-5 h-11 text-[14px] font-semibold text-ink transition hover:bg-line",
  chip: "inline-flex items-center gap-2 rounded-full border px-4 h-10 text-sm font-semibold whitespace-nowrap transition",
};

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex" aria-label={`${value.toFixed(1)} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= Math.round(value) ? "fill-star text-star" : "fill-line text-line"} />
      ))}
    </span>
  );
}

export function RatingLine({ avg, count }: { avg: number; count: number }) {
  if (!count) return <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand">{t("Yangi")}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <b>{avg.toFixed(1)}</b>
      <Stars value={avg} size={13} />
      <span className="text-muted">({count})</span>
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand ${className}`} />;
}

export function Section({ title, sub, action, children, id }: { title: string; sub?: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] sm:text-[28px] font-extrabold tracking-tight">{title}</h2>
          {sub && <p className="mt-1 text-muted">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Gorizontal karusel: telefon — surish, kompyuter — strelkalar */
export function Carousel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const go = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <div className="relative group">
      <div ref={ref} className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {children}
      </div>
      {[-1, 1].map((d) => (
        <button key={d} onClick={() => go(d)} aria-label={d < 0 ? t("Oldingi") : t("Keyingi")}
          className={`absolute top-[38%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white shadow-md transition hover:scale-105 lg:flex ${d < 0 ? "-left-5" : "-right-5"} opacity-0 group-hover:opacity-100`}>
          {d < 0 ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      ))}
    </div>
  );
}

/** Modal: telefonda pastdan chiquvchi oyna, kompyuterda markazda */
export function Modal({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-black/45" aria-label={t("Yopish")} onClick={onClose} />
      <div className={`sheet relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}>
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 sm:px-6 sm:pt-5">
          <div className="min-w-0 text-lg font-extrabold">{title}</div>
          <button onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-soft" aria-label={t("Yopish")}><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
      </div>
    </div>
  );
}

export function ErrorText({ text }: { text: string | null }) {
  return text ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-hot" role="alert">{text}</p> : null;
}

export function Img({ src, alt, className = "" }: { src?: string | null; alt: string; className?: string }) {
  return src
    ? <img src={src} alt={alt} loading="lazy" className={`h-full w-full object-cover ${className}`} />
    : <div className={`flex h-full w-full items-center justify-center bg-soft text-muted ${className}`}><span className="text-3xl font-extrabold opacity-30">{alt.slice(0, 1)}</span></div>;
}
