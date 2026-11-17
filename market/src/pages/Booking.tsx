// Bron oqimi (Fresha tuzilishi): to'liq sahifa, qadamlar Xizmat › Mutaxassis › Vaqt › Tasdiqlash, o'ngda savat.
// Kirish faqat tasdiqlashdan oldin so'raladi. Hot Slot havolasi (service+member+at) to'g'ridan-to'g'ri tasdiqqa olib keladi.
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api, ApiError, Appointment, BusinessDetail, Quote, Slot } from "../api";
import { useAuth } from "../auth";
import { btn, ErrorText, Img, RatingLine, Spinner } from "../components/ui";
import { dateLong, durationText, money, nextDays, timeOf } from "../util";

type Step = "service" | "master" | "time" | "confirm";
const STEPS: [Step, string][] = [["service", "Xizmat"], ["master", "Mutaxassis"], ["time", "Vaqt"], ["confirm", "Tasdiqlash"]];
const ANY = -1;
type PickSlot = { starts_at: string; time: string; member: number };

export default function Booking() {
  const { slug = "" } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { me, requireAuth } = useAuth();
  const q = useQuery({ queryKey: ["biz", slug], queryFn: () => api<BusinessDetail>(`/catalog/businesses/${slug}`) });
  const b = q.data;

  const hotAt = sp.get("at");
  const [service, setService] = useState<number | null>(sp.get("service") ? Number(sp.get("service")) : null);
  const [member, setMember] = useState<number | null>(sp.get("member") ? Number(sp.get("member")) : null);
  // Usta havolasi (?member=): mutaxassis oldindan tanlangan — faqat uning xizmatlari, "mutaxassis" qadami o'tkaziladi
  const pinned = !hotAt && sp.get("member") ? Number(sp.get("member")) : null;
  const [step, setStep] = useState<Step>(hotAt ? "confirm" : sp.get("service") ? (pinned ? "time" : "master") : "service");
  const days = nextDays(21);
  const [day, setDay] = useState(sp.get("day") ?? days[0].iso);
  const [slot, setSlot] = useState<PickSlot | null>(hotAt && sp.get("member") ? { starts_at: hotAt, time: timeOf(hotAt), member: Number(sp.get("member")) } : null);
  const [slots, setSlots] = useState<PickSlot[] | null>(null);
  const [group, setGroup] = useState<number | "all">("all");
  const [promo, setPromo] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Appointment | null>(null);

  const services = useMemo(() => b?.service_groups.flatMap((g) => g.services) ?? [], [b]);
  const svc = services.find((s) => s.id === service);
  const masters = useMemo(() => (b && service ? b.staff.filter((m) => m.service_ids.includes(service)) : []), [b, service]);
  const chosen = b?.staff.find((m) => m.member_id === (slot?.member ?? member));

  // Bo'sh vaqtlar ("Farqi yo'q" — har vaqtga o'sha kuni eng ko'p bo'sh vaqti bor usta)
  useEffect(() => {
    if (step !== "time" || !service || member === null || !b) return;
    let alive = true;
    setSlots(null);
    const one = async (m: number) => (await api<{ slots: Slot[] }>(`/catalog/slots?${new URLSearchParams({ member_id: String(m), service_id: String(service), date: day })}`)).slots
      .map((x) => ({ starts_at: x.starts_at, time: x.time, member: m }));
    (async () => {
      try {
        if (member !== ANY) { const s = await one(member); if (alive) setSlots(s); return; }
        const lists = await Promise.all(masters.map((m) => one(m.member_id).catch(() => [] as PickSlot[])));
        const free = new Map(lists.map((l, i) => [masters[i].member_id, l.length]));
        const best = new Map<string, PickSlot>();
        for (const p of lists.flat()) { const c = best.get(p.starts_at); if (!c || (free.get(p.member) ?? 0) > (free.get(c.member) ?? 0)) best.set(p.starts_at, p); }
        if (alive) setSlots([...best.values()].sort((a, z) => a.starts_at.localeCompare(z.starts_at)));
      } catch (e) { if (alive) { setSlots([]); setError(e instanceof ApiError ? e.message : "Yuklab bo'lmadi"); } }
    })();
    return () => { alive = false; };
  }, [step, service, member, day, b, masters]);

  // Narx va chegirmani server hisoblaydi (kirgan bo'lsa)
  useEffect(() => {
    if (step !== "confirm" || !slot || !service || !me) { setQuote(null); return; }
    api<Quote>("/appointments/quote", { method: "POST", body: { member_id: slot.member, service_id: service, starts_at: slot.starts_at, promo_code: applied } })
      .then(setQuote).catch(() => setQuote(null));
  }, [step, slot, service, me, applied]);

  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (!b) return <div className="p-10 text-center">Muassasa topilmadi</div>;

  const idx = STEPS.findIndex(([s]) => s === step);
  const canNext = step === "service" ? !!service : step === "master" ? member !== null : step === "time" ? !!slot : !busy;
  const final = quote ? quote.final : svc?.price ?? 0;
  const codeError = quote?.code_error ? {
    promo_not_found: "Promokod topilmadi yoki muddati tugagan", promo_used: "Bu promokoddan allaqachon foydalangansiz",
    promo_limit: "Promokod limiti tugagan", promo_first_visit: "Bu promokod faqat birinchi tashrif uchun",
  }[quote.code_error] : null;

  const submit = async () => {
    if (!slot || !service) return;
    if (!requireAuth("Bronni tasdiqlash uchun profilingizga kiring yoki ro'yxatdan o'ting")) return;
    setBusy(true); setError(null);
    try {
      setDone(await api<Appointment>("/appointments", { method: "POST", body: {
        member_id: slot.member, service_id: service, starts_at: slot.starts_at, note: note.trim() || null,
        promo_code: applied && !quote?.code_error ? applied : null,
      } }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "time_conflict") { setSlot(null); setStep("time"); }
      setError(e instanceof ApiError ? e.message : "Bajarib bo'lmadi");
    } finally { setBusy(false); }
  };
  const next = () => {
    setError(null);
    if (step === "confirm") return void submit();
    if (step === "service" && pinnedStaff) return setStep("time");
    setStep(STEPS[idx + 1][0]);
  };
  const back = () => (idx === 0 || hotAt ? nav(`/s/${b.slug}`)
    : step === "time" && pinnedStaff ? setStep("service") : setStep(STEPS[idx - 1][0]));

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <span className="bg-brand-grad flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg"><Check size={40} /></span>
        <h1 className="mt-6 text-3xl font-extrabold">Bron yuborildi!</h1>
        <p className="mt-3 text-muted">{b.name}, {dateLong(done.starts_at)}, {timeOf(done.starts_at)} — {done.member_name}. Salon tasdiqlagach xabar beramiz.</p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <Link to="/bronlarim" className={btn.primary}>Bronlarim</Link>
          <Link to="/" className={btn.outline}>Bosh sahifa</Link>
        </div>
      </div>
    );
  }

  const groups = b.service_groups;
  const pinnedStaff = pinned !== null ? b.staff.find((m) => m.member_id === pinned) : undefined;
  const visible = (group === "all" ? services : groups.find((g) => (g.category_id ?? 0) === group)?.services ?? [])
    .filter((s) => !pinnedStaff || pinnedStaff.service_ids.includes(s.id));

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-white/95 px-4 backdrop-blur sm:px-8">
        <button onClick={back} className="flex h-11 w-11 items-center justify-center rounded-full border border-line hover:border-brand" aria-label="Orqaga"><ArrowLeft size={20} /></button>
        <Link to={`/s/${b.slug}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-line hover:border-brand" aria-label="Yopish"><X size={20} /></Link>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-32 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:pb-12">
        <div className="min-w-0">
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm">
            {STEPS.map(([s, l], i) => (
              <span key={s} className="flex items-center gap-1">
                <span className={i === idx ? "font-bold text-ink" : i < idx ? "text-brand" : "text-muted"}>{l}</span>
                {i < STEPS.length - 1 && <ChevronRight size={14} className="text-muted" />}
              </span>
            ))}
          </nav>
          <h1 className="mb-6 text-[30px] font-extrabold leading-tight sm:text-[38px]">
            {step === "service" ? "Xizmatni tanlang" : step === "master" ? "Mutaxassisni tanlang" : step === "time" ? "Sana va vaqtni tanlang" : "Tasdiqlang"}
          </h1>

          {step === "service" && (
            <>
              {groups.length > 1 && (
                <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
                  {[{ id: "all" as const, name: "Hammasi" }, ...groups.map((g) => ({ id: g.category_id ?? 0, name: g.category_name }))].map((g) => (
                    <button key={String(g.id)} onClick={() => setGroup(g.id)} className={`${btn.chip} ${group === g.id ? "border-navy bg-navy text-white" : "border-line"}`}>{g.name}</button>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {visible.map((s) => {
                  const on = s.id === service;
                  return (
                    <button key={s.id} onClick={() => { setService(s.id); setMember(pinnedStaff ? pinned : null); setSlot(null); }}
                      className={`flex w-full items-center gap-4 rounded-2xl border-2 p-5 text-left transition ${on ? "border-brand bg-brand-soft/40" : "border-line hover:border-brand/40"}`}>
                      <span className="min-w-0 flex-1">
                        <b className="block">{s.name}</b>
                        <span className="text-sm text-muted">{durationText(s.duration_min)}</span>
                        {s.description && <span className="mt-1 block text-sm text-muted line-clamp-2">{s.description}</span>}
                        <b className="mt-2 block">{money(s.price)}</b>
                      </span>
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-brand bg-brand text-white" : "border-line"}`}>{on && <Check size={16} />}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === "master" && (
            <div className="space-y-3">
              {[{ member_id: ANY, full_name: "Farqi yo'q", title: "Eng yaqin bo'sh vaqtli mutaxassis", rating_avg: 0, rating_count: 0, photo_url: null }, ...masters].map((m) => {
                const on = member === m.member_id;
                return (
                  <button key={m.member_id} onClick={() => { setMember(m.member_id); setSlot(null); }}
                    className={`flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition ${on ? "border-brand bg-brand-soft/40" : "border-line hover:border-brand/40"}`}>
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-brand">
                      {m.member_id === ANY ? <Shuffle size={22} /> : m.photo_url ? <img src={m.photo_url} alt="" className="h-full w-full object-cover" /> : <b className="text-lg">{m.full_name.slice(0, 1)}</b>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block">{m.full_name}</b>
                      <span className="text-sm text-muted">{m.title}{m.rating_count ? ` · ★ ${m.rating_avg.toFixed(1)}` : ""}</span>
                    </span>
                    <span className={`rounded-full border px-4 py-2 text-sm font-bold ${on ? "border-brand bg-brand text-white" : "border-line"}`}>{on ? "Tanlandi" : "Tanlash"}</span>
                  </button>
                );
              })}
            </div>
          )}

          {step === "time" && (
            <>
              <div className="no-scrollbar -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 py-1">
                {days.map((d) => (
                  <button key={d.iso} onClick={() => { setDay(d.iso); setSlot(null); }}
                    className={`flex w-[68px] shrink-0 flex-col items-center rounded-2xl border-2 py-3 transition ${day === d.iso ? "border-brand bg-brand text-white" : "border-line hover:border-brand/40"}`}>
                    <span className={`text-xs ${day === d.iso ? "text-white/80" : "text-muted"}`}>{d.wd}</span>
                    <b className="text-xl">{d.day}</b>
                    <span className={`text-[11px] ${day === d.iso ? "text-white/80" : "text-muted"}`}>{d.month.slice(0, 3)}</span>
                  </button>
                ))}
              </div>
              {slots === null ? <div className="flex justify-center py-10"><Spinner /></div>
                : slots.length === 0 ? <p className="rounded-2xl bg-soft p-6 text-center text-muted">Bu kunda bo'sh vaqt yo'q. Boshqa kunni tanlang.</p>
                  : (
                    <div className="space-y-6">
                      {[["Ertalab", 0, 12], ["Kunduzi", 12, 17], ["Kechqurun", 17, 24]].map(([label, from, to]) => {
                        const list = slots.filter((p) => +p.time.slice(0, 2) >= (from as number) && +p.time.slice(0, 2) < (to as number));
                        if (!list.length) return null;
                        return (
                          <div key={label as string}>
                            <p className="mb-2 text-sm font-bold text-muted">{label as string}</p>
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                              {list.map((p) => (
                                <button key={p.starts_at} onClick={() => setSlot(p)}
                                  className={`h-12 rounded-xl border-2 font-bold transition ${slot?.starts_at === p.starts_at ? "border-brand bg-brand text-white" : "border-line hover:border-brand/50"}`}>{p.time}</button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
            </>
          )}

          {step === "confirm" && slot && (
            <div className="space-y-5">
              <div className="rounded-2xl bg-soft p-5">
                <p className="text-lg font-bold">{dateLong(slot.starts_at)}, {slot.time}</p>
                <p className="text-muted">{svc?.name} · {svc ? durationText(svc.duration_min) : ""} · {chosen?.full_name}</p>
              </div>
              {me ? (
                <>
                  <div>
                    <p className="mb-2 font-bold">Promokod</p>
                    <div className="flex gap-2">
                      <input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="Masalan: CHRONIX10"
                        className="h-12 min-w-0 flex-1 rounded-full border-2 border-line px-5 font-semibold uppercase outline-none focus:border-brand" />
                      <button onClick={() => setApplied(promo.trim() || null)} className={btn.dark} disabled={!promo.trim()}>Qo'llash</button>
                    </div>
                    {codeError && <p className="mt-2 text-sm text-hot">{codeError}</p>}
                    {quote && quote.discount > 0 && <p className="mt-2 text-sm font-semibold text-ok">Chegirma −{quote.percent}% qo'llandi</p>}
                  </div>
                  <div>
                    <p className="mb-2 font-bold">Izoh (ixtiyoriy)</p>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} placeholder="Salonga xabar…"
                      className="w-full rounded-2xl border-2 border-line p-4 outline-none focus:border-brand" />
                  </div>
                </>
              ) : (
                <p className="rounded-2xl bg-brand-soft p-4 text-sm">Bronni tasdiqlash uchun kirish so'raladi — telefon, Telegram yoki Google orqali. Tanlovingiz saqlanib qoladi.</p>
              )}
              <ErrorText text={error} />
            </div>
          )}
          {step !== "confirm" && <div className="mt-4"><ErrorText text={error} /></div>}
        </div>

        {/* Savat */}
        <aside className="lg:block">
          <div className="sticky top-20 rounded-3xl border border-line p-5 shadow-[0_20px_50px_-30px_rgba(10,22,80,.5)] max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-auto max-lg:z-40 max-lg:rounded-b-none max-lg:border-x-0 max-lg:border-b-0 max-lg:bg-white">
            <div className="flex items-center gap-3 max-lg:hidden">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl"><Img src={b.photos[0]} alt={b.name} /></div>
              <div className="min-w-0"><p className="truncate font-bold">{b.name}</p><RatingLine avg={b.rating_avg} count={b.rating_count} /><p className="truncate text-xs text-muted">{b.address}</p></div>
            </div>
            <div className="my-4 space-y-2 border-y border-line py-4 text-sm max-lg:hidden">
              {slot && <p className="font-semibold">{dateLong(slot.starts_at)}, {slot.time}</p>}
              {svc ? (
                <div className="flex justify-between gap-3">
                  <span><b className="block">{svc.name}</b><span className="text-muted">{durationText(svc.duration_min)}{chosen ? ` · ${chosen.full_name}` : member === ANY ? " · istalgan mutaxassis" : ""}</span></span>
                  <b className="shrink-0">{money(svc.price)}</b>
                </div>
              ) : <p className="text-muted">Xizmat tanlanmagan</p>}
              {quote && quote.discount > 0 && <p className="flex justify-between text-ok"><span>Chegirma</span><b>−{money(quote.discount)}</b></p>}
            </div>
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-sm text-muted">Jami</p><p className="text-xl font-extrabold">{svc ? money(final) : "—"}</p></div>
              <button onClick={next} disabled={!canNext} className={`${btn.primary} lg:hidden`}>{step === "confirm" ? "Tasdiqlash" : "Davom etish"}</button>
            </div>
            <button onClick={next} disabled={!canNext} className={`${btn.primary} mt-4 w-full max-lg:hidden`}>
              {busy ? <Spinner className="border-t-white" /> : step === "confirm" ? "Bronni tasdiqlash" : "Davom etish"}
            </button>
            <p className="mt-3 text-center text-xs text-muted max-lg:hidden">To'lov salonda — naqd yoki karta orqali</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
