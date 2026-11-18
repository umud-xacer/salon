import { CalendarDays, LogOut, Menu, Search, User, X } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth";
import { BIZ_URL, PANEL_URL } from "../util";
import { AuthModal } from "./AuthModal";
import { lang, otherLangUrl, t } from "../i18n";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 ${className}`} aria-label={t("Chronix — bosh sahifa")}>
      <img src="/logo.svg" alt="" className="h-8 w-8" />
      <span className="text-[22px] font-extrabold tracking-tight text-navy">Chronix</span>
    </Link>
  );
}

function Header() {
  const { me, requireAuth, signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const home = loc.pathname === "/";

  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 8);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);
  useEffect(() => setMenu(false), [loc.pathname]);

  return (
    <header className={`sticky top-0 z-[500] bg-white/95 backdrop-blur transition-shadow ${scrolled || !home ? "shadow-[0_1px_0_#e6e6eb]" : ""}`}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:h-[72px] sm:px-6 lg:px-8">
        <Logo />
        {!home && loc.pathname !== "/qidiruv" && (
          <button onClick={() => nav("/qidiruv")}
            className="hidden h-11 flex-1 max-w-md items-center gap-3 rounded-full border border-line px-5 text-left text-sm text-muted shadow-sm transition hover:shadow md:flex">
            <Search size={18} className="text-ink" /> {t("Barcha xizmatlar va salonlar")}
          </button>
        )}
        <nav className="hidden items-center gap-2 md:flex">
          <LangSwitch />
          <Link to={BIZ_URL} className="rounded-full px-4 py-2.5 text-sm font-semibold hover:bg-soft">{t("Biznes uchun")}</Link>
          {me ? (
            <>
              <NavLink to="/bronlarim" className="rounded-full px-4 py-2.5 text-sm font-semibold hover:bg-soft">{t("Bronlarim")}</NavLink>
              <NavLink to="/profil" className="bg-brand-grad flex h-11 w-11 items-center justify-center rounded-full text-base font-bold text-white" aria-label={t("Profil")}>
                {(me.user.full_name || "?").slice(0, 1).toUpperCase()}
              </NavLink>
            </>
          ) : (
            <button onClick={() => requireAuth(t("Bronlaringizni boshqarish uchun profilingizga kiring yoki ro'yxatdan o'ting"))}
              className="rounded-full border border-line px-5 py-2.5 text-sm font-bold hover:border-ink">{t("Kirish")}</button>
          )}
        </nav>
        <button className="flex h-11 w-11 items-center justify-center rounded-full border border-line md:hidden" onClick={() => setMenu((v) => !v)}
          aria-label={t("Menyu")} aria-expanded={menu}>
          {menu ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {menu && (
        <div className="rise border-t border-line bg-white px-4 pb-5 pt-2 md:hidden">
          {me ? (
            <>
              <MenuLink to="/bronlarim" icon={<CalendarDays size={18} />}>{t("Bronlarim")}</MenuLink>
              <MenuLink to="/profil" icon={<User size={18} />}>{t("Profil")}</MenuLink>
            </>
          ) : (
            <button onClick={() => { setMenu(false); requireAuth(t("Bronlaringizni boshqarish uchun profilingizga kiring yoki ro'yxatdan o'ting")); }}
              className="mt-2 flex h-12 w-full items-center justify-center rounded-full bg-brand font-bold text-white">{t("Kirish yoki ro'yxatdan o'tish")}</button>
          )}
          <div className="mt-2 flex items-center justify-between px-2"><span className="font-semibold">{t("Til")}</span><LangSwitch /></div>
          <Link to={BIZ_URL} className="mt-2 flex h-12 items-center gap-3 rounded-xl px-2 font-semibold">{t("Biznes uchun Chronix")}</Link>
          {me && (
            <button onClick={() => { void signOut(); setMenu(false); }} className="flex h-12 w-full items-center gap-3 rounded-xl px-2 font-semibold text-hot">
              <LogOut size={18} /> {t("Chiqish")}
            </button>
          )}
        </div>
      )}
    </header>
  );
}

/** O'zbekcha / Русский — sahifa boshqa tildagi manziliga to'liq qayta yuklanadi */
function LangSwitch() {
  return (
    <span className="inline-flex rounded-full bg-soft p-1 text-xs font-bold" role="group" aria-label={t("Til")}>
      {(["uz", "ru"] as const).map((l) => (
        l === lang
          ? <span key={l} className="rounded-full bg-white px-2.5 py-1 shadow-sm">{l.toUpperCase()}</span>
          : <a key={l} href={otherLangUrl()} hrefLang={l} className="rounded-full px-2.5 py-1 text-muted hover:text-ink">{l.toUpperCase()}</a>
      ))}
    </span>
  );
}

function MenuLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return <Link to={to} className="flex h-12 items-center gap-3 rounded-xl px-2 font-semibold">{icon}{children}</Link>;
}

function Footer() {
  return (
    <footer className="mt-10 bg-navy text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="space-y-3">
          <Logo />
          <p className="text-sm text-white/60">{t("Vaqtingiz – bizning ustuvorligimiz. Salon, barber, stomatologiya va SPA'ga onlayn bron.")}</p>
        </div>
        <div>
          <h4 className="mb-3 font-bold">{t("Mijozlar uchun")}</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li><Link to="/qidiruv" className="hover:text-white">{t("Salon qidirish")}</Link></li>
            <li><Link to="/bronlarim" className="hover:text-white">{t("Bronlarim")}</Link></li>
            <li><a href="/hisobni-ochirish" className="hover:text-white">{t("Hisobni o'chirish")}</a></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 font-bold">{t("Biznes uchun")}</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li><Link to={BIZ_URL} className="hover:text-white">{t("Chronix biznes uchun")}</Link></li>
            <li><Link to={`${BIZ_URL}#narxlar`} className="hover:text-white">{t("Narxlar")}</Link></li>
            <li><a href={PANEL_URL} className="hover:text-white">{t("Panelga kirish")}</a></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 font-bold">{t("Kompaniya")}</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li><a href="/privacy" className="hover:text-white">{t("Maxfiylik siyosati")}</a></li>
            <li><a href="https://t.me/JabborqulovUmidjon" className="hover:text-white">Telegram</a></li>
            <li><a href="tel:+998200035599" className="hover:text-white">+998 20 003 55 99</a></li>
          </ul>
        </div>
      </div>
      <p className="border-t border-white/10 py-5 text-center text-xs text-white/50">© {new Date().getFullYear()} Chronix</p>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <AuthModal />
    </div>
  );
}
