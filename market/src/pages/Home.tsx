// Bosh sahifa (Fresha tuzilishi, Chronix uslubi): to'q ko'k hero + qidiruv, yo'nalishlar, tavsiya etilganlar,
// bugungi chegirmalar (Hot Slots), yaqin atrofdagilar, yangilar, ilova va biznes bloklari.
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, CalendarCheck2, Clock3, Flame, Smartphone } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { api, BusinessCard, Category, HotSlot } from "../api";
import { AppShowcase } from "../components/AppShowcase";
import { SalonCard } from "../components/SalonCard";
import { SearchBar } from "../components/SearchBar";
import { Carousel, Img, Section } from "../components/ui";
import { BIZ_URL, distanceText, money, PLAY_URL, useLocation2 } from "../util";
import { pick, t } from "../i18n";

const nearbyUrl = (lat: number, lng: number, extra: Record<string, string>) =>
  `/catalog/businesses/nearby?${new URLSearchParams({ lat: String(lat), lng: String(lng), radius_m: "50000", ...extra })}`;

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/catalog/categories"), staleTime: 3600_000 });
}

export default function Home() {
  const loc = useLocation2();
  const nav = useNavigate();
  const cats = useCategories();
  const rated = useQuery({ queryKey: ["near", "rating", loc.lat, loc.lng], queryFn: () => api<{ items: BusinessCard[]; total: number }>(nearbyUrl(loc.lat, loc.lng, { sort: "rating", limit: "12" })) });
  const near = useQuery({ queryKey: ["near", "distance", loc.lat, loc.lng], queryFn: () => api<{ items: BusinessCard[]; total: number }>(nearbyUrl(loc.lat, loc.lng, { sort: "distance", limit: "30" })) });
  const hot = useQuery({ queryKey: ["hot", loc.lat, loc.lng], queryFn: () => api<HotSlot[]>(`/catalog/hot-slots?${new URLSearchParams({ lat: String(loc.lat), lng: String(loc.lng), radius_m: "50000", limit: "20" })}`) });

  const featured = (rated.data?.items ?? []).filter((b) => b.rating_count > 0);
  const fresh = (near.data?.items ?? []).filter((b) => b.rating_count === 0);
  const total = near.data?.total ?? 0;

  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="hero-bg relative text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-8 pt-10 sm:px-6 sm:pt-12 lg:grid-cols-[1.15fr_.85fr] lg:px-8 lg:pb-8 lg:pt-12">
          <div className="rise">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold ring-1 ring-white/15">
              <Clock3 size={15} className="text-cyan" /> {t("Vaqtingiz – bizning ustuvorligimiz")}
            </p>
            <h1 className="text-[38px] font-extrabold leading-[1.05] tracking-tight sm:text-[52px] lg:text-[58px]">
              {t("Navbatsiz yoziling.")}<br /><span className="text-brand-grad">{t("Bir necha soniyada.")}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/75">
              {t("Toshkentdagi go'zallik salonlari, barbershoplar, stomatologiya va SPA markazlari — haqiqiy sharhlar, narxlar va bo'sh vaqtlar bilan.")}
            </p>
            {total > 0 && (
              <p className="mt-6 flex items-center gap-2 text-sm text-white/70">
                <BadgeCheck size={18} className="text-cyan" /> <b className="text-white">{total}</b> {t("ta muassasa onlayn bron qabul qiladi")}
              </p>
            )}
          </div>
          <div className="relative hidden h-[330px] lg:block" aria-hidden>
            <div className="absolute right-0 top-0 h-[250px] w-[200px] overflow-hidden rounded-[28px] ring-4 ring-white/10"><Img src="/img/hero-0.webp" alt="" /></div>
            <div className="absolute bottom-0 left-6 h-[220px] w-[180px] overflow-hidden rounded-[28px] ring-4 ring-white/10"><Img src="/img/hero-1.webp" alt="" /></div>
            <div className="absolute bottom-10 right-24 h-[150px] w-[130px] overflow-hidden rounded-[24px] ring-4 ring-white/10"><Img src="/img/hero-2.webp" alt="" /></div>
            <div className="absolute left-0 top-14 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-ink shadow-xl">
              <span className="bg-brand-grad flex h-10 w-10 items-center justify-center rounded-full text-white"><CalendarCheck2 size={20} /></span>
              <span><b className="block text-sm">{t("Bron tasdiqlandi")}</b><span className="text-xs text-muted">{t("Bugun, 15:30 · Soch olish")}</span></span>
            </div>
          </div>
        </div>
        <div className="relative z-20 mx-auto -mb-1 max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          <SearchBar categories={cats.data ?? []} />
        </div>
      </section>

      {/* ── Yo'nalishlar ───────────────────────────────────────────────── */}
      {!!cats.data?.length && (
        <Section title={t("Yo'nalishlar")} sub={t("Sizga kerakli xizmatni tanlang")}>
          <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-5">
            {cats.data.map((c) => (
              <button key={c.id} onClick={() => nav(`/qidiruv?category=${c.slug}`)}
                className="group relative aspect-[4/3] w-[44vw] shrink-0 overflow-hidden rounded-2xl text-left sm:w-auto">
                <Img src={`/img/cat-${c.slug}.webp`} alt={pick(c.name_uz, c.name_ru)} className="transition duration-500 group-hover:scale-105" />
                <span className="absolute inset-0 bg-gradient-to-t from-navy/85 via-navy/20 to-transparent" />
                <span className="absolute bottom-3 left-4 right-4 text-[17px] font-bold text-white">{pick(c.name_uz, c.name_ru)}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ── Tavsiya etilganlar ─────────────────────────────────────────── */}
      {featured.length > 0 && (
        <Section title={t("Tavsiya etilganlar")} sub={t("Mijozlar eng yuqori baholagan muassasalar")}
          action={<Link to="/qidiruv?sort=rating" className="hidden items-center gap-1 text-sm font-bold text-brand sm:flex">{t("Hammasi")} <ArrowRight size={16} /></Link>}>
          <Carousel>{featured.map((b) => <SalonCard key={b.id} b={b} />)}</Carousel>
        </Section>
      )}

      {/* ── Bugungi chegirmalar (Hot Slots) ────────────────────────────── */}
      {!!hot.data?.length && (
        <section className="bg-soft">
          <Section title={t("Bugungi chegirmalar")} sub={t("Bo'sh qolgan vaqtlar arzonroq — tez band qiling")}>
            <Carousel>
              {hot.data.map((h) => (
                <Link key={`${h.business_id}-${h.service_id}-${h.starts_at}`}
                  to={`/s/${h.business_slug}/bron?service=${h.service_id}&member=${h.member_id}&at=${encodeURIComponent(h.starts_at)}`}
                  className="group w-[72vw] shrink-0 snap-start overflow-hidden rounded-2xl bg-white ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-lg sm:w-[280px]">
                  <div className="relative h-36">
                    <Img src={h.photo} alt={h.business_name} />
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-hot px-2.5 py-1 text-xs font-extrabold text-white"><Flame size={13} /> −{h.percent}%</span>
                    <span className="absolute right-3 top-3 rounded-full bg-navy/80 px-2.5 py-1 text-xs font-bold text-white">{h.time}</span>
                  </div>
                  <div className="space-y-1 p-4">
                    <p className="truncate font-bold">{pick(h.service_name, h.service_name_ru)}</p>
                    <p className="truncate text-sm text-muted">{[h.business_name, distanceText(h.distance_m)].filter(Boolean).join(" · ")}</p>
                    <p className="flex items-baseline gap-2"><b>{money(h.final)}</b><s className="text-sm text-muted">{money(h.price)}</s></p>
                  </div>
                </Link>
              ))}
            </Carousel>
          </Section>
        </section>
      )}

      {/* ── Yaqin atrofda ──────────────────────────────────────────────── */}
      {!!near.data?.items.length && (
        <Section title={loc.precise ? t("Yaqin atrofingizda") : t("Toshkentda")} sub={t("Masofa bo'yicha")}
          action={<Link to="/qidiruv" className="hidden items-center gap-1 text-sm font-bold text-brand sm:flex">{t("Xaritada ko'rish")} <ArrowRight size={16} /></Link>}>
          <Carousel>{near.data.items.slice(0, 16).map((b) => <SalonCard key={b.id} b={b} />)}</Carousel>
        </Section>
      )}

      {/* ── Chronix'da yangi ───────────────────────────────────────────── */}
      {fresh.length > 0 && featured.length > 0 && (
        <Section title={t("Chronix'da yangi")} sub={t("Yaqinda qo'shilgan muassasalar")}>
          <Carousel>{fresh.map((b) => <SalonCard key={b.id} b={b} />)}</Carousel>
        </Section>
      )}

      {/* ── Ilova qanday ishlaydi (animatsiya) ───────────────────────── */}
      <AppShowcase />

      {/* ── Ilova va biznes ────────────────────────────────────────────── */}
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div className="hero-bg relative overflow-hidden rounded-[32px] p-8 text-white sm:p-10">
          <Smartphone size={34} className="text-cyan" />
          <h3 className="mt-4 text-3xl font-extrabold">{t("Chronix ilovasi")}</h3>
          <p className="mt-2 max-w-md text-white/75">{t("Bronlar, eslatmalar, chegirmalar va bonuslar — hammasi telefoningizda.")}</p>
          {PLAY_URL
            ? <a href={PLAY_URL} className="mt-6 inline-flex h-12 items-center rounded-full bg-white px-6 font-bold text-navy">{t("Google Play'dan yuklab oling")}</a>
            : <span className="mt-6 inline-flex h-12 items-center rounded-full bg-white/10 px-6 font-bold ring-1 ring-white/20">{t("Tez orada Google Play'da")}</span>}
        </div>
        <div className="relative overflow-hidden rounded-[32px] bg-brand-soft p-8 sm:p-10">
          <p className="text-sm font-bold uppercase tracking-wide text-brand">{t("Biznes uchun")}</p>
          <h3 className="mt-2 text-3xl font-extrabold text-navy">{t("Salon, klinika yoki SPA egasimisiz?")}</h3>
          <p className="mt-2 max-w-md text-muted">{t("Onlayn bron, kalendar, kassa, ombor va oylik hisob-kitob — bitta Chronix panelida.")}</p>
          <Link to={BIZ_URL} className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-navy px-6 font-bold text-white">{t("Batafsil")} <ArrowRight size={18} /></Link>
        </div>
      </section>
    </>
  );
}
