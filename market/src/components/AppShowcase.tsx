// Chronix ilovasi qanday ishlashi — telefon ichida ekranlar o'zi almashadi (animatsiya), yonida qadamlar.
// Ekranlar ilova dizaynining soddalashtirilgan ko'rinishi (rasm emas, HTML) — har qanday o'lchamda tiniq.
import { Bell, CalendarCheck2, Check, MapPin, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { t as tr } from "../i18n";

const STEPS = [
  { t: tr("Toping"), d: tr("Yaqin atrofdagi salon, barber, stomatologiya va SPA — reyting va narxlar bilan") },
  { t: tr("Tanlang"), d: tr("Xizmat, usta va o'zingizga qulay vaqtni bir necha bosishda tanlaysiz") },
  { t: tr("Band qiling"), d: tr("Bron darhol salonga yetadi — qo'ng'iroq va navbat kerak emas") },
  { t: tr("Eslatma oling"), d: tr("Tashrifdan oldin ilova eslatadi, kerak bo'lsa vaqtni ko'chirasiz") },
];

function ScreenHome() {
  return (
    <div className="flex h-full flex-col gap-2.5 p-3 pt-10">
      <p className="text-[9px] font-bold text-muted">📍 {tr("Toshkent")}</p>
      <div className="flex items-center gap-2 rounded-full bg-soft px-3 py-2 text-[10px] text-muted"><Search size={11} /> {tr("Barcha xizmatlar")}</div>
      <div className="grid grid-cols-4 gap-1.5">
        {[tr("Salon"), tr("Barber"), tr("Stomat."), "SPA"].map((x, i) => (
          <div key={x} className="chx-pop flex flex-col items-center gap-1 rounded-xl bg-brand-soft py-2 text-[8px] font-bold text-navy" style={{ animationDelay: `${i * 90}ms` }}>
            <span className="h-4 w-4 rounded-full bg-brand-grad" />{x}
          </div>
        ))}
      </div>
      <p className="text-[11px] font-extrabold">{tr("Tavsiya etilganlar")}</p>
      {[["/img/hero-0.webp", "Malika Beauty", "4,9"], ["/img/hero-1.webp", "Old School Barbers", "4,8"]].map(([img, n, r], i) => (
        <div key={n} className="chx-pop overflow-hidden rounded-xl ring-1 ring-line" style={{ animationDelay: `${300 + i * 120}ms` }}>
          <img src={img} alt="" className="h-16 w-full object-cover" />
          <div className="flex items-center justify-between px-2 py-1.5 text-[9px]"><b>{n}</b><span className="flex items-center gap-0.5 font-bold"><Star size={9} className="fill-star text-star" />{r}</span></div>
        </div>
      ))}
    </div>
  );
}

function ScreenSalon() {
  return (
    <div className="flex h-full flex-col">
      <img src="/img/hero-2.webp" alt="" className="h-24 w-full object-cover" />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-[12px] font-extrabold">Aqua Relax Center</p>
        <p className="flex items-center gap-1 text-[8px] text-muted"><MapPin size={9} /> {tr("Yakkasaroy · 1,2 km")}</p>
        {[[tr("Klassik massaj"), tr("{a} daq", { a: 60 }), "250 000"], [tr("Hammom + SPA"), tr("{a} daq", { a: 90 }), "380 000"], [tr("Yuz parvarishi"), tr("{a} daq", { a: 45 }), "200 000"]].map(([n, d, p], i) => (
          <div key={n} className={`chx-pop flex items-center justify-between rounded-xl border p-2 text-[9px] ${i === 0 ? "border-brand bg-brand-soft" : "border-line"}`} style={{ animationDelay: `${i * 120}ms` }}>
            <span><b className="block">{n}</b><span className="text-muted">{d} · {tr("{a} so'm", { a: p })}</span></span>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full ${i === 0 ? "bg-brand text-white" : "border border-line"}`}>{i === 0 && <Check size={9} />}</span>
          </div>
        ))}
        <div className="mt-auto grid grid-cols-4 gap-1">
          {["10:00", "11:30", "14:00", "16:30"].map((t, i) => (
            <span key={t} className={`chx-pop rounded-lg py-1.5 text-center text-[9px] font-bold ${i === 2 ? "bg-brand text-white" : "bg-soft"}`} style={{ animationDelay: `${400 + i * 70}ms` }}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScreenDone() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
      <span className="chx-ring bg-brand-grad flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg"><Check size={30} /></span>
      <p className="text-[14px] font-extrabold">{tr("Bron yuborildi!")}</p>
      <p className="text-[9px] text-muted">Aqua Relax Center<br />{tr("Ertaga, 14:00 · Klassik massaj")}</p>
      <div className="w-full rounded-xl bg-soft p-2 text-[9px]"><div className="flex justify-between"><span className="text-muted">{tr("Jami")}</span><b>{tr("{a} so'm", { a: "250 000" })}</b></div></div>
    </div>
  );
}

function ScreenReminder() {
  return (
    <div className="relative flex h-full flex-col gap-2 bg-gradient-to-b from-navy to-navy-2 p-3 pt-10 text-white">
      <p className="text-center text-[28px] font-extrabold">13:30</p>
      <p className="text-center text-[8px] text-white/60">{tr("Seshanba, 17-noyabr")}</p>
      <div className="chx-drop mt-3 rounded-2xl bg-white/95 p-2.5 text-ink shadow-xl">
        <p className="flex items-center gap-1.5 text-[9px] font-bold"><span className="flex h-4 w-4 items-center justify-center rounded bg-brand-grad text-white"><Bell size={8} /></span> {tr("Chronix · hozir")}</p>
        <p className="mt-1 text-[10px] font-bold">{tr("Tashrifingizga 30 daqiqa qoldi")}</p>
        <p className="text-[9px] text-muted">{tr("Aqua Relax Center, 14:00. Kelasizmi?")}</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px] font-bold">
          <span className="rounded-lg bg-brand py-1 text-center text-white">{tr("Kelaman")}</span>
          <span className="rounded-lg bg-soft py-1 text-center">{tr("Ko'chirish")}</span>
        </div>
      </div>
    </div>
  );
}

const SCREENS = [ScreenHome, ScreenSalon, ScreenDone, ScreenReminder];

export function AppShowcase() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setI((x) => (x + 1) % SCREENS.length), 3200);
    return () => clearInterval(t);
  }, [paused]);
  const Screen = SCREENS[i];

  return (
    <section className="hero-bg relative overflow-hidden text-white">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-24">
        <div>
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold ring-1 ring-white/15"><CalendarCheck2 size={15} className="text-cyan" /> {tr("Chronix ilovasi")}</p>
          <h2 className="text-[34px] font-extrabold leading-tight sm:text-[44px]">{tr("Bron —")} <span className="text-brand-grad">{tr("cho'ntagingizda")}</span></h2>
          <p className="mt-3 max-w-lg text-white/70">{tr("Ilovada qanday ishlashini ko'ring: to'rt qadam va siz navbatsiz yozildingiz.")}</p>
          <ol className="mt-8 space-y-3">
            {STEPS.map((s, k) => (
              <li key={s.t}>
                <button onMouseEnter={() => { setPaused(true); setI(k); }} onMouseLeave={() => setPaused(false)} onClick={() => setI(k)}
                  className={`flex w-full gap-4 rounded-2xl p-4 text-left transition ${i === k ? "bg-white/12 ring-1 ring-white/20" : "opacity-60 hover:opacity-90"}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-extrabold ${i === k ? "bg-brand-grad" : "bg-white/10"}`}>{k + 1}</span>
                  <span>
                    <b className="block text-lg">{s.t}</b>
                    <span className="text-sm text-white/70">{s.d}</span>
                    {i === k && !paused && <span className="mt-3 block h-1 overflow-hidden rounded-full bg-white/15"><i key={i} className="chx-progress block h-full bg-cyan" /></span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative mx-auto h-[560px] w-[290px]">
          {/* Yog'du */}
          <div className="absolute -inset-16 rounded-full bg-[radial-gradient(circle,rgba(43,210,255,.35),transparent_60%)] blur-2xl" aria-hidden />
          {/* Telefon */}
          <div className="chx-float relative h-full w-full rounded-[46px] bg-[#05091f] p-3 shadow-[0_40px_80px_-20px_rgba(0,0,0,.7)] ring-1 ring-white/15">
            <div className="absolute left-1/2 top-4 z-10 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
            <div className="relative h-full w-full overflow-hidden rounded-[36px] bg-white text-ink">
              <div key={i} className="chx-screen absolute inset-0"><Screen /></div>
            </div>
          </div>
          {/* Suzuvchi kartochkalar */}
          <div className="chx-float-2 absolute -left-16 top-24 hidden rounded-2xl bg-white px-4 py-3 text-ink shadow-2xl sm:block">
            <p className="flex items-center gap-1 text-sm font-extrabold"><Star size={14} className="fill-star text-star" /> 4,9</p>
            <p className="text-xs text-muted">{tr("Mijozlar bahosi")}</p>
          </div>
          <div className="chx-float-3 absolute -right-14 bottom-28 hidden items-center gap-2 rounded-2xl bg-white px-4 py-3 text-ink shadow-2xl sm:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-hot/10 text-sm font-extrabold text-hot">%</span>
            <span><b className="block text-sm">{tr("−20% bugun")}</b><span className="text-xs text-muted">{tr("Bo'sh vaqtga chegirma")}</span></span>
          </div>
          <div className="mt-5 flex justify-center gap-2">
            {SCREENS.map((_, k) => <button key={k} onClick={() => setI(k)} aria-label={tr("{a}-ekran", { a: k + 1 })} className={`h-2 rounded-full transition-all ${i === k ? "w-6 bg-cyan" : "w-2 bg-white/30"}`} />)}
          </div>
        </div>
      </div>
    </section>
  );
}
