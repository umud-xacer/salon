// Salon sahifasi (Fresha tuzilishi): breadcrumb, sarlavha, galereya + lightbox, yopishqoq tablar, xizmatlar,
// jamoa, sharhlar, ma'lumot (ish vaqti, xarita), o'ngda yopishqoq bron kartasi, filiallar va o'xshash salonlar.
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock, Flame, Heart, MapPin, Navigation, Phone, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api, BusinessCard, BusinessDetail, HotSlot, ReviewsOut } from "../api";
import { useAuth } from "../auth";
import { MapView } from "../components/MapView";
import { SalonCard } from "../components/SalonCard";
import { btn, Carousel, Img, RatingLine, Section, Spinner, Stars } from "../components/ui";
import { addRecent, durationText, money, weekdayName } from "../util";

type Tab = "xizmatlar" | "jamoa" | "sharhlar" | "malumot";
const TABS: [Tab, string][] = [["xizmatlar", "Xizmatlar"], ["jamoa", "Jamoa"], ["sharhlar", "Sharhlar"], ["malumot", "Ma'lumot"]];

function todayIso() { return ((new Date().getUTCDay() + 6) % 7) + 1; }
const directions = (lat?: number, lng?: number) => lat != null && lng != null ? `https://yandex.uz/maps/?rtext=~${lat},${lng}&rtt=auto` : "#";

export default function Salon() {
  const { slug = "" } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { me, requireAuth } = useAuth();
  const [group, setGroup] = useState<number | "all">("all");
  const [allServices, setAllServices] = useState(false);
  const [light, setLight] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("xizmatlar");
  const [fav, setFav] = useState(false);
  const [reviewsShown, setReviewsShown] = useState(6);
  const refs = useRef<Record<Tab, HTMLElement | null>>({ xizmatlar: null, jamoa: null, sharhlar: null, malumot: null });

  const q = useQuery({ queryKey: ["biz", slug], queryFn: () => api<BusinessDetail>(`/catalog/businesses/${slug}`) });
  const b = q.data;
  const reviews = useQuery({ queryKey: ["reviews", slug], queryFn: () => api<ReviewsOut>(`/catalog/businesses/${slug}/reviews?limit=30`), enabled: !!b });
  const similar = useQuery({
    queryKey: ["similar", slug, b?.category],
    enabled: !!b?.lat,
    queryFn: () => api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${new URLSearchParams({ lat: String(b!.lat), lng: String(b!.lng), radius_m: "50000", sort: "rating", limit: "12", ...(b!.category ? { category: b!.category } : {}) })}`),
  });
  const hot = useQuery({
    queryKey: ["hot-biz", b?.id], enabled: !!b?.lat,
    queryFn: () => api<HotSlot[]>(`/catalog/hot-slots?${new URLSearchParams({ lat: String(b!.lat), lng: String(b!.lng), radius_m: "500", limit: "20" })}`),
  });
  const deals = (hot.data ?? []).filter((h) => h.business_id === b?.id);

  useEffect(() => { if (b) { addRecent(b.slug); document.title = `${b.name} — Chronix`; } }, [b]);
  useEffect(() => {
    if (!me || !b) { setFav(false); return; }
    api<number[]>("/me/favorites/ids").then((ids) => setFav(ids.includes(b.id))).catch(() => {});
  }, [me, b]);

  // Qaysi bo'lim ko'rinib turibdi — tab shunga qarab yonadi
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      const v = es.filter((e) => e.isIntersecting).sort((a, z) => a.boundingClientRect.top - z.boundingClientRect.top)[0];
      if (v) setTab(v.target.id as Tab);
    }, { rootMargin: "-140px 0px -60% 0px" });
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [b]);

  const services = useMemo(() => b?.service_groups.flatMap((g) => g.services) ?? [], [b]);
  const shown = useMemo(() => {
    const list = group === "all" ? services : b?.service_groups.find((g) => (g.category_id ?? 0) === group)?.services ?? [];
    return allServices ? list : list.slice(0, 8);
  }, [group, services, b, allServices]);

  if (q.isLoading) return <div className="flex justify-center py-32"><Spinner /></div>;
  if (!b) return <div className="mx-auto max-w-xl px-4 py-24 text-center"><h1 className="text-2xl font-extrabold">Muassasa topilmadi</h1><Link to="/" className={`${btn.primary} mt-6`}>Bosh sahifa</Link></div>;

  const day = sp.get("day");
  const book = (serviceId?: number) => nav(`/s/${b.slug}/bron?${new URLSearchParams({ ...(serviceId ? { service: String(serviceId) } : {}), ...(day ? { day } : {}) })}`);
  const today = b.hours?.find((h) => h.weekday === todayIso());
  const photos = b.photos.length ? b.photos : [];
  const toggleFav = async () => {
    if (!requireAuth("Sevimli salonlarni saqlash uchun profilingizga kiring")) return;
    const next = !fav;
    setFav(next);
    await api(`/me/favorites/${b.id}`, { method: next ? "PUT" : "DELETE" }).catch(() => setFav(!next));
  };
  const share = async () => {
    const url = window.location.href.split("?")[0];
    if (navigator.share) await navigator.share({ title: b.name, url }).catch(() => {});
    else await navigator.clipboard?.writeText(url).catch(() => {});
  };
  const goto = (t: Tab) => { const el = refs.current[t]; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 140, behavior: "smooth" }); };
  const r = reviews.data;

  return (
    <div className="pb-24 lg:pb-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <nav className="flex flex-wrap items-center gap-1 pt-5 text-xs text-muted" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-brand">Bosh sahifa</Link> ·
          <Link to={`/qidiruv?category=${b.category ?? ""}`} className="hover:text-brand">{b.category_name}</Link> ·
          <span className="text-ink">{b.name}</span>
        </nav>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[40px]">
              {b.chain_name && b.branch_name ? `${b.chain_name}` : b.name}
              {b.branch_name && <span className="font-semibold text-muted"> · {b.branch_name}</span>}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <RatingLine avg={b.rating_avg} count={b.rating_count} />
              <span className="text-line">•</span>
              <span className={b.is_open_now ? "font-semibold text-ok" : "font-semibold text-hot"}>
                {b.is_open_now ? `Ochiq${today ? ` · ${today.closes_at.slice(0, 5)} gacha` : ""}` : "Hozir yopiq"}
              </span>
              {b.address && <><span className="text-line">•</span><span className="text-muted">{b.address}</span></>}
              <a href={directions(b.lat, b.lng)} target="_blank" rel="noopener" className="font-semibold text-brand">Yo'nalish</a>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={share} className="flex h-11 w-11 items-center justify-center rounded-full border border-line hover:border-brand" aria-label="Ulashish"><Share2 size={18} /></button>
            <button onClick={toggleFav} className="flex h-11 w-11 items-center justify-center rounded-full border border-line hover:border-brand" aria-label="Sevimlilar">
              <Heart size={18} className={fav ? "fill-hot text-hot" : ""} />
            </button>
          </div>
        </div>

        {/* Galereya */}
        <div className="mt-5 grid h-[260px] gap-2 overflow-hidden rounded-3xl sm:h-[420px] sm:grid-cols-[2fr_1fr] sm:grid-rows-2">
          {[0, 1, 2].map((i) => (
            <button key={i} onClick={() => photos[i] && setLight(i)}
              className={`relative overflow-hidden bg-soft ${i === 0 ? "sm:row-span-2" : "hidden sm:block"}`}>
              <Img src={photos[i]} alt={`${b.name} — rasm ${i + 1}`} className="transition duration-500 hover:scale-[1.03]" />
              {i === 2 && photos.length > 3 && <span className="absolute bottom-3 right-3 rounded-full bg-white px-4 py-2 text-sm font-bold shadow">Barcha rasmlar ({photos.length})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Yopishqoq tablar */}
      <div className="sticky top-16 z-30 mt-6 border-b border-line bg-white/95 backdrop-blur sm:top-[72px]">
        <div className="no-scrollbar mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => goto(id)}
              className={`shrink-0 border-b-2 px-4 py-3.5 text-sm font-bold transition ${tab === id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
        <div className="min-w-0 space-y-12">
          {/* Bugungi chegirmalar */}
          {deals.length > 0 && (
            <div className="rounded-3xl bg-gradient-to-r from-[#fff1f3] to-brand-soft p-5">
              <p className="mb-3 flex items-center gap-2 font-extrabold"><Flame size={18} className="text-hot" /> Bugungi chegirmalar</p>
              <div className="no-scrollbar flex gap-3 overflow-x-auto">
                {deals.map((h) => (
                  <button key={`${h.service_id}-${h.starts_at}`}
                    onClick={() => nav(`/s/${b.slug}/bron?service=${h.service_id}&member=${h.member_id}&at=${encodeURIComponent(h.starts_at)}`)}
                    className="w-[180px] shrink-0 rounded-2xl bg-white p-3 text-left ring-1 ring-line transition hover:ring-brand">
                    <p className="flex items-center gap-2"><b className="text-lg">{h.time}</b><span className="rounded-full bg-hot px-2 py-0.5 text-xs font-bold text-white">−{h.percent}%</span></p>
                    <p className="truncate text-sm text-muted">{h.service_name} · {h.member_name}</p>
                    <p className="mt-1 text-sm"><b>{money(h.final)}</b> <s className="text-muted">{money(h.price)}</s></p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Xizmatlar */}
          <section id="xizmatlar" ref={(el) => { refs.current.xizmatlar = el; }}>
            <h2 className="mb-4 text-2xl font-extrabold">Xizmatlar</h2>
            {b.service_groups.length > 1 && (
              <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
                {[{ id: "all" as const, name: "Hammasi" }, ...b.service_groups.map((g) => ({ id: g.category_id ?? 0, name: g.category_name }))].map((g) => (
                  <button key={String(g.id)} onClick={() => setGroup(g.id)}
                    className={`${btn.chip} ${group === g.id ? "border-navy bg-navy text-white" : "border-line hover:border-brand"}`}>{g.name}</button>
                ))}
              </div>
            )}
            <div className="space-y-3">
              {shown.map((s) => (
                <div key={s.id} className="flex items-center gap-4 rounded-2xl border border-line p-4 transition hover:border-brand/40 hover:shadow-sm sm:p-5">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold">{s.name}</h3>
                    <p className="mt-0.5 text-sm text-muted">{durationText(s.duration_min)}</p>
                    {s.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{s.description}</p>}
                    <p className="mt-2 font-bold">{money(s.price)}</p>
                  </div>
                  <button onClick={() => book(s.id)} className="rounded-full border border-line px-5 py-2.5 text-sm font-bold transition hover:border-brand hover:bg-brand hover:text-white">Band qilish</button>
                </div>
              ))}
              {!allServices && (group === "all" ? services.length : shown.length) > 8 && (
                <button onClick={() => setAllServices(true)} className={btn.outline}>Barcha xizmatlar</button>
              )}
            </div>
          </section>

          {/* Jamoa */}
          {b.staff.length > 0 && (
            <section id="jamoa" ref={(el) => { refs.current.jamoa = el; }}>
              <h2 className="mb-5 text-2xl font-extrabold">Jamoa</h2>
              <div className="grid grid-cols-3 gap-5 sm:grid-cols-4 lg:grid-cols-5">
                {b.staff.map((m) => (
                  <div key={m.member_id} className="text-center">
                    <div className="mx-auto h-20 w-20 overflow-hidden rounded-full bg-brand-soft ring-2 ring-white shadow-md sm:h-24 sm:w-24">
                      {m.photo_url ? <img src={m.photo_url} alt={m.full_name} className="h-full w-full object-cover" />
                        : <span className="bg-brand-grad flex h-full w-full items-center justify-center text-2xl font-extrabold text-white">{m.full_name.slice(0, 1)}</span>}
                    </div>
                    {m.rating_count > 0 && <span className="relative -mt-3 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold shadow">★ {m.rating_avg.toFixed(1)}</span>}
                    <p className="mt-1.5 truncate font-bold">{m.full_name}</p>
                    {m.title && <p className="truncate text-xs text-muted">{m.title}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Sharhlar */}
          <section id="sharhlar" ref={(el) => { refs.current.sharhlar = el; }}>
            <h2 className="mb-5 text-2xl font-extrabold">Sharhlar</h2>
            {r && r.summary.count > 0 ? (
              <>
                <div className="mb-6 flex flex-col gap-6 rounded-3xl bg-soft p-6 sm:flex-row sm:items-center">
                  <div className="text-center sm:w-40">
                    <p className="text-5xl font-extrabold text-navy">{(r.summary.rating_avg ?? 0).toFixed(1)}</p>
                    <Stars value={r.summary.rating_avg ?? 0} size={16} />
                    <p className="mt-1 text-sm text-muted">{r.summary.count} ta sharh</p>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {[5, 4, 3, 2, 1].map((n) => {
                      const c = r.summary.distribution[String(n)] ?? 0;
                      return (
                        <div key={n} className="flex items-center gap-3 text-sm">
                          <span className="w-3 font-semibold">{n}</span>
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-line"><i className="bg-brand-grad block h-full rounded-full" style={{ width: `${r.summary.count ? (c / r.summary.count) * 100 : 0}%` }} /></span>
                          <span className="w-8 text-right text-muted">{c}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  {r.items.slice(0, reviewsShown).map((x) => (
                    <article key={x.id} className="rounded-2xl border border-line p-5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft font-bold text-brand">{x.author.slice(0, 1)}</span>
                        <div><p className="font-bold">{x.author}</p><p className="text-xs text-muted">{new Date(x.created_at).toLocaleDateString("ru-RU")}</p></div>
                      </div>
                      <div className="mt-3"><Stars value={x.rating} /></div>
                      {x.comment && <p className="mt-2 text-[15px]">{x.comment}</p>}
                      {x.member_name && <p className="mt-2 text-xs text-muted">Usta: {x.member_name}</p>}
                      {x.reply && <p className="mt-3 rounded-xl bg-soft p-3 text-sm"><b>Salon javobi:</b> {x.reply}</p>}
                    </article>
                  ))}
                </div>
                {r.items.length > reviewsShown && <button onClick={() => setReviewsShown((n) => n + 10)} className={`${btn.outline} mt-5`}>Yana sharhlar</button>}
              </>
            ) : (
              <p className="rounded-2xl bg-soft p-6 text-muted">Hali sharh yo'q. Tashrifdan keyin birinchi bo'lib baho qoldiring.</p>
            )}
          </section>

          {/* Ma'lumot */}
          <section id="malumot" ref={(el) => { refs.current.malumot = el; }} className="space-y-6">
            <h2 className="text-2xl font-extrabold">Ma'lumot</h2>
            {b.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink/80">{b.description}</p>}
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="mb-3 flex items-center gap-2 font-bold"><Clock size={18} className="text-brand" /> Ish vaqti</h3>
                <ul className="space-y-2 text-sm">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                    const h = b.hours?.find((x) => x.weekday === d);
                    return (
                      <li key={d} className={`flex justify-between ${d === todayIso() ? "font-bold text-ink" : "text-muted"}`}>
                        <span className="flex items-center gap-2"><i className={`h-2 w-2 rounded-full ${h ? "bg-ok" : "bg-line"}`} />{weekdayName(d)}</span>
                        <span>{h ? `${h.opens_at.slice(0, 5)} – ${h.closes_at.slice(0, 5)}` : "Yopiq"}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="space-y-3">
                <h3 className="flex items-center gap-2 font-bold"><MapPin size={18} className="text-brand" /> Manzil</h3>
                <p className="text-sm text-muted">{b.address}</p>
                {b.lat != null && b.lng != null && (
                  <MapView pins={[{ id: b.id, lat: b.lat, lng: b.lng, label: b.name.slice(0, 18) }]} center={[b.lat, b.lng]} zoom={15} className="h-48 w-full overflow-hidden rounded-2xl" />
                )}
                <div className="flex gap-2">
                  <a href={directions(b.lat, b.lng)} target="_blank" rel="noopener" className={`${btn.soft} flex-1`}><Navigation size={16} /> Yo'nalish</a>
                  {b.phone && <a href={`tel:${b.phone}`} className={`${btn.soft} flex-1`}><Phone size={16} /> Qo'ng'iroq</a>}
                </div>
              </div>
            </div>
            {!!b.branches?.length && (
              <div>
                <h3 className="mb-3 font-bold">Boshqa filiallar</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {b.branches.filter((x) => x.slug !== b.slug).map((x) => (
                    <Link key={x.id} to={`/s/${x.slug}`} className="rounded-2xl border border-line p-4 hover:border-brand">
                      <p className="font-bold">{x.branch_name ?? x.name}</p>
                      <p className="text-sm text-muted">{x.address}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* O'ng yopishqoq bron kartasi */}
        <aside className="hidden lg:block">
          <div className="sticky top-[150px] rounded-3xl border border-line p-6 shadow-[0_20px_50px_-30px_rgba(10,22,80,.5)]">
            <h3 className="text-xl font-extrabold">{b.name}</h3>
            <div className="mt-1"><RatingLine avg={b.rating_avg} count={b.rating_count} /></div>
            <button onClick={() => book()} className={`${btn.primary} mt-5 w-full`}>Band qilish</button>
            <ul className="mt-5 space-y-3 text-sm">
              <li className="flex gap-2"><Clock size={16} className="mt-0.5 shrink-0 text-brand" />{b.is_open_now ? `Ochiq${today ? ` · ${today.closes_at.slice(0, 5)} gacha` : ""}` : "Hozir yopiq"}</li>
              {b.address && <li className="flex gap-2"><MapPin size={16} className="mt-0.5 shrink-0 text-brand" />{b.address}</li>}
            </ul>
          </div>
        </aside>
      </div>

      {/* O'xshash salonlar */}
      {!!similar.data?.items.filter((x) => x.id !== b.id).length && (
        <Section title="O'xshash muassasalar" sub="Yaqin atrofdagi shu yo'nalishdagi salonlar">
          <Carousel>{similar.data.items.filter((x) => x.id !== b.id).map((x) => <SalonCard key={x.id} b={x} />)}</Carousel>
        </Section>
      )}

      {/* Telefonda pastki panel */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-line bg-white px-4 py-3 lg:hidden">
        <div className="min-w-0"><p className="truncate font-bold">{services.length} ta xizmat</p><p className="text-xs text-muted">{b.is_open_now ? "Hozir ochiq" : "Hozir yopiq"}</p></div>
        <button onClick={() => book()} className={btn.primary}>Band qilish</button>
      </div>

      {/* Lightbox */}
      {light !== null && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/90" onClick={() => setLight(null)}>
          <img src={photos[light]} alt="" className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain" onClick={(e) => e.stopPropagation()} />
          <button className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Yopish"><X /></button>
          {photos.length > 1 && <>
            <button onClick={(e) => { e.stopPropagation(); setLight((light - 1 + photos.length) % photos.length); }} className="absolute left-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Oldingi"><ChevronLeft /></button>
            <button onClick={(e) => { e.stopPropagation(); setLight((light + 1) % photos.length); }} className="absolute right-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Keyingi"><ChevronRight /></button>
          </>}
          <p className="absolute bottom-6 text-sm text-white/70">{light + 1} / {photos.length}</p>
        </div>
      )}
    </div>
  );
}
