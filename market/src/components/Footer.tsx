// chronix.uz pastki qismi (2026-11-18): brend, havola ustunlari, ilovalar va tezkor tugmalar, ijtimoiy tarmoqlar.
// Faqat haqiqatan mavjud sahifa va kontaktlarga havola (bo'sh "Blog/Yangiliklar" qo'yilmaydi — 404 bo'lmasin).
// Havolalar va kontaktlar Super Admin → "Sayt sozlamalari"dan keladi; bo'sh maydon ko'rsatilmaydi.
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, CreditCard, Mail, MapPin, MessageCircle, Phone, Send } from "lucide-react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { getSiteSettings, SITE_FALLBACK } from "../api";
import { lang, t } from "../i18n";
import { BIZ_URL, PANEL_URL } from "../util";

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  );
}

function YoutubeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
      <path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15.1V8.9l5.8 3.1-5.8 3.1z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden>
      <path fill="#00D7FE" d="M3.6 2.2 13.4 12l-9.8 9.8c-.3-.2-.5-.6-.5-1.1V3.3c0-.5.2-.9.5-1.1z" />
      <path fill="#FFCE00" d="m16.7 15.3-3.3-3.3 3.3-3.3 3.8 2.2c1 .6 1 1.6 0 2.2l-3.8 2.2z" />
      <path fill="#FF3A44" d="M16.7 15.3 13.4 12l-9.8 9.8c.4.4 1 .4 1.7 0l11.4-6.5z" />
      <path fill="#00F076" d="M16.7 8.7 5.3 2.2c-.7-.4-1.3-.4-1.7 0l9.8 9.8 3.3-3.3z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="currentColor" aria-hidden>
      <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8s2.3-1.3 3.1-2.5c1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.5z" />
    </svg>
  );
}

function StoreBadge({ icon, top, name, href }: { icon: ReactElement; top: string; name: string; href: string }) {
  const inner = (
    <>
      {icon}
      <span className="leading-tight">
        <span className="block text-[10px] font-medium uppercase tracking-wide text-white/60">{top}</span>
        <span className="block whitespace-nowrap text-[15px] font-bold">{name}</span>
      </span>
    </>
  );
  const cls = "flex h-14 items-center gap-3 rounded-2xl border border-white/15 bg-white/5 px-4 text-white transition";
  return <a href={href} target="_blank" rel="noopener" className={`${cls} hover:border-white/30 hover:bg-white/10`}>{inner}</a>;
}

function Col({ title, children }: { title: string; children: (ReactElement | false)[] }) {
  return (
    <div>
      <h4 className="mb-4 text-sm font-bold uppercase tracking-wider text-white/90">{title}</h4>
      <ul className="space-y-3 text-[15px] text-white/60">{children.filter(Boolean).map((c, i) => <li key={i}>{c}</li>)}</ul>
    </div>
  );
}

const link = "transition hover:text-white";

export function Footer() {
  const year = new Date().getFullYear();
  const q = useQuery({ queryKey: ["site-settings"], queryFn: getSiteSettings, staleTime: 5 * 60_000, retry: 1 });
  const s = q.data ?? SITE_FALLBACK;
  const ru = lang === "ru";
  const about = (ru ? s.about_ru : s.about_uz)
    || t("Go'zallik salonlari va xizmat ko'rsatish bizneslari uchun professional CRM va avtomatlashtirish tizimi.");
  const address = ru ? s.address_ru || s.address_uz : s.address_uz;
  const hours = ru ? s.work_hours_ru || s.work_hours_uz : s.work_hours_uz;
  const tel = s.phone.replace(/[^\d+]/g, "");
  const socials = [
    { href: s.telegram_url, label: "Telegram", icon: <Send size={17} />, hover: "hover:bg-[#229ED9]" },
    { href: s.instagram_url, label: "Instagram", icon: <InstagramIcon />, hover: "hover:bg-[#E1306C]" },
    { href: s.youtube_url, label: "YouTube", icon: <YoutubeIcon />, hover: "hover:bg-[#FF0000]" },
  ].filter((x) => x.href);
  const hasApps = Boolean(s.play_url || s.appstore_url);
  return (
    <footer className="relative mt-16 overflow-hidden bg-[#060B1F] text-white">
      {/* Yumshoq nur — sahifa uslubidagi brend ko'k */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/4 h-80 w-[40rem] rounded-full bg-[#1f5bff]/20 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1fr_2.5fr_1.1fr] lg:gap-10">
          {/* Brend */}
          <div className="space-y-5">
            <Link to="/" className="inline-flex items-center gap-2" aria-label={t("Chronix — bosh sahifa")}>
              <img src="/logo.svg" alt="" className="h-9 w-9" />
              <span className="text-2xl font-extrabold tracking-tight">Chronix</span>
            </Link>
            <p className="max-w-sm leading-relaxed text-white/60">
              {about}
            </p>
            <p className="text-sm font-semibold text-[#7aa2ff]">{t("Vaqtingiz – bizning ustuvorligimiz")}</p>
          </div>

          {/* Havolalar */}
          <div className="grid gap-10 sm:grid-cols-[1fr_1fr_1.45fr] sm:gap-6">
            <Col title={t("Biz haqimizda")}>{[
              <Link key="f" to={`${BIZ_URL}#imkoniyatlar`} className={link}>{t("Imkoniyatlar")}</Link>,
              <Link key="a" to={`${BIZ_URL}#afzalliklar`} className={link}>{t("Afzalliklar")}</Link>,
              <Link key="p" to={`${BIZ_URL}#narxlar`} className={link}>{t("Tariflar")}</Link>,
              <Link key="s" to="/qidiruv" className={link}>{t("Salon qidirish")}</Link>,
            ]}</Col>
            <Col title={t("Resurslar")}>{[
              !!s.telegram_url && <a key="h" href={s.telegram_url} target="_blank" rel="noopener" className={link}>{t("Yordam va savollar")}</a>,
              <a key="pn" href={PANEL_URL} className={link}>{t("Panelga kirish")}</a>,
              <Link key="b" to="/bronlarim" className={link}>{t("Bronlarim")}</Link>,
              <a key="d" href="/hisobni-ochirish" className={link}>{t("Hisobni o'chirish")}</a>,
            ]}</Col>
            <Col title={t("Kontaktlar")}>{[
              <Link key="c" to={`${BIZ_URL}#boglanish`} className={link}>{t("Bog'lanish")}</Link>,
              !!s.phone && <a key="t" href={`tel:${tel}`} className={`${link} inline-flex items-center gap-2 whitespace-nowrap tabular-nums`}><Phone size={15} />{s.phone}</a>,
              !!s.email && <a key="e" href={`mailto:${s.email}`} className={`${link} inline-flex items-center gap-2`}><Mail size={15} className="shrink-0" />{s.email}</a>,
              !!s.telegram_url && <a key="tg" href={s.telegram_url} target="_blank" rel="noopener" className={`${link} inline-flex items-center gap-2`}><Send size={15} />Telegram</a>,
              !!address && <span key="ad" className="inline-flex gap-2"><MapPin size={15} className="mt-1 shrink-0" />{address}</span>,
              !!hours && <span key="wh" className="inline-flex gap-2"><Clock size={15} className="mt-1 shrink-0" />{hours}</span>,
            ]}</Col>
          </div>

          {/* Ilovalar va tezkor tugmalar */}
          <div className="space-y-5">
            <h4 className="text-sm font-bold uppercase tracking-wider text-white/90">
              {hasApps ? t("Ilovani yuklab oling") : t("Biznesingizni ulang")}
            </h4>
            {hasApps && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-1 xl:grid-cols-2">
                {s.play_url && <StoreBadge icon={<PlayIcon />} top={t("Yuklab oling")} name="Google Play" href={s.play_url} />}
                {s.appstore_url && <StoreBadge icon={<AppleIcon />} top={t("Yuklab oling")} name="App Store" href={s.appstore_url} />}
              </div>
            )}
            <div className={`grid gap-3 ${hasApps ? "pt-2" : ""}`}>
              <Link to={`${BIZ_URL}#boglanish`}
                className="bg-brand-grad inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 font-bold text-white shadow-lg shadow-[#1f5bff]/30 transition hover:brightness-110">
                <MessageCircle size={18} /> {t("Konsultatsiyaga yozilish")}
              </Link>
              <a href={PANEL_URL} title={t("Direktor panelidagi «Obuna» bo'limida Click yoki Payme orqali")}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/20 px-6 font-bold text-white transition hover:border-white/40 hover:bg-white/5">
                <CreditCard size={18} /> {t("Obuna to'lovi")} <span className="text-xs font-semibold text-white/50">Click · Payme</span>
              </a>
            </div>
          </div>
        </div>

        {/* Pastki qator */}
        <div className="mt-14 flex flex-col-reverse items-center justify-between gap-5 border-t border-white/10 pt-6 sm:flex-row">
          <p className="text-center text-sm text-white/50 sm:text-left">
            {t("Copyright © {a} Chronix. Barcha huquqlar himoyalangan.", { a: year })}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-white/60">
            <a href="/privacy" className={link}>{t("Maxfiylik siyosati")}</a>
            <a href="/privacy" className={link}>{t("Foydalanish shartlari")}</a>
            {socials.map((x) => (
              <a key={x.label} href={x.href} target="_blank" rel="noopener" aria-label={x.label} title={x.label}
                className={`flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition ${x.hover}`}>
                {x.icon}
              </a>
            ))}
            <Link to={`${BIZ_URL}#boglanish`} className={`${link} hidden items-center gap-1 font-semibold text-white md:inline-flex`}>
              {t("Biznesingizni ulang")} <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
