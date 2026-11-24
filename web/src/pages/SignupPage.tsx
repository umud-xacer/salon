// Direktorning o'zi ro'yxatdan o'tishi (Fresha uslubi): har qadamda bitta savol, tepada jarayon chizig'i.
// 0) Telefon Telegram bot orqali tasdiqlanadi  1) Ism va parol  2) Yo'nalish  3) Jamoa hajmi  4) Muassasa
// Natija: muassasa "kutilmoqda" holatida, Super Admin tasdiqlagach 5 kunlik bepul sinov boshlanadi.
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Ear, Leaf, Pill, Scissors, Smile, Sparkles, Stethoscope, Store, User, Users,
         type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { signupCategories, signupRegions, signupSubmit, signupTelegramPoll, signupTelegramStart,
         type SignupPoll, type TeamSize } from "../api/onboarding";
import { useAuth } from "../auth/AuthProvider";
import { PasswordField } from "../components/PasswordField";
import { ErrorNote, Logo } from "../components/ui";
import { getLang, LangSwitch, t } from "../i18n";

const ICONS: Record<string, LucideIcon> = {
  beauty_salon: Sparkles, barbershop: Scissors, pharmacy: Pill, clinic: Stethoscope, dental: Smile, ent: Ear, spa: Leaf,
};
const TEAM: { value: TeamSize; label: string; hint: string }[] = [
  { value: "1", label: t("Faqat o'zim"), hint: t("Yakka mutaxassis — bron to'g'ridan-to'g'ri sizga") },
  { value: "2-5", label: t("2–5 kishi"), hint: t("Kichik jamoa") },
  { value: "6-10", label: t("6–10 kishi"), hint: t("O'rta muassasa") },
  { value: "11-20", label: t("11–20 kishi"), hint: t("Katta jamoa") },
  { value: "21+", label: t("21 va undan ko'p"), hint: t("Bir nechta filial yoki katta markaz") },
];
const STEPS = 5;
const field = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[15px] text-slate-900 shadow-sm "
  + "outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

function Choice({ active, onClick, icon: Icon, title, hint }: {
  active: boolean; onClick: () => void; icon?: LucideIcon; title: string; hint?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition ${active
        ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/20" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
      {Icon && (
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
          <Icon size={22} aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-slate-900">{title}</span>
        {hint && <span className="mt-0.5 block text-[13px] text-slate-500">{hint}</span>}
      </span>
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
        {active && <Check size={14} strokeWidth={3} aria-hidden />}
      </span>
    </button>
  );
}

export function SignupPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tg, setTg] = useState<{ nonce: string; url: string } | null>(null);
  const [verified, setVerified] = useState<SignupPoll | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [team, setTeam] = useState<TeamSize | null>(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [contact, setContact] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const categories = useQuery({ queryKey: ["signup-categories"], queryFn: signupCategories, staleTime: Infinity });
  const regions = useQuery({ queryKey: ["signup-regions"], queryFn: signupRegions, staleTime: Infinity, enabled: step >= 4 });
  const districts = regions.data?.find((r) => r.name === region)?.districts ?? [];

  // Telegram tasdig'ini kutish: bot raqamni olgach token keladi
  useEffect(() => {
    if (!tg) return;
    timer.current = window.setInterval(async () => {
      try {
        const r = await signupTelegramPoll(tg.nonce);
        if (r.status === "ok") {
          window.clearInterval(timer.current);
          setTg(null);
          setVerified(r);
          setFullName((v) => v || r.full_name || "");
          setStep(1);
        }
      } catch (e) {
        window.clearInterval(timer.current);
        setTg(null);
        setError(e);
      }
    }, 2000);
    return () => window.clearInterval(timer.current);
  }, [tg]);

  async function startTelegram() {
    setError(null);
    setBusy(true);
    try {
      const r = await signupTelegramStart();
      setTg({ nonce: r.nonce, url: r.url });
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const canNext = [
    !!verified,
    fullName.trim().length >= 2 && password.length >= 8,
    categoryId !== null,
    team !== null,
    name.trim().length >= 2 && region !== "",
  ][step];

  async function next(e?: FormEvent) {
    e?.preventDefault();
    if (!canNext) return;
    setError(null);
    if (step < STEPS - 1) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const r = await signupSubmit({
        signup_token: verified!.signup_token!, full_name: fullName.trim(), password, category_id: categoryId!,
        team_size: team!, business_name: name.trim(), region: region || null, city: city || null,
        address: address.trim() || null, contact_phone: contact.trim() || verified!.phone,
      });
      await signIn(r);
      navigate(`/${r.business_slug}`, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const titles = [
    [t("Muassasangizni Chronix'ga qo'shing"), t("Bir necha daqiqada ro'yxatdan o'ting. Tasdiqlangach 5 kun bepul foydalanasiz.")],
    [t("Hisobingizni yarating"), t("Panelga shu telefon va parol bilan kirasiz")],
    [t("Qaysi yo'nalishda ishlaysiz?"), t("Asosiy xizmatingizni tanlang — tavsiya xizmatlar shunga mos bo'ladi")],
    [t("Jamoangiz qancha?"), t("Taxminiy son yetarli — keyin o'zgartirish mumkin")],
    [t("Muassasa haqida"), t("Mijozlar sizni shu nom bilan topadi")],
  ][step];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-3 px-4">
          <Logo size={32} />
          <span className="text-[15px] font-semibold text-slate-900">Chronix</span>
          <span className="flex-1" />
          <LangSwitch />
          <a href="/" className="text-sm font-medium text-blue-600 hover:underline">{t("Kirish")}</a>
        </div>
        <div className="h-1 bg-slate-100" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step + 1}>
          <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${((step + 1) / STEPS) * 100}%` }} />
        </div>
      </header>

      <form onSubmit={next} className="mx-auto max-w-lg px-4 pb-32 pt-8 sm:pt-12">
        <p className="text-[13px] font-medium text-slate-500">{t("{a}-qadam / {b}", { a: step + 1, b: STEPS })}</p>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight text-slate-900">{titles[0]}</h1>
        <p className="mt-2 text-[15px] text-slate-500">{titles[1]}</p>

        <div className="mt-7 space-y-3">
          {step === 0 && (
            <>
              <ul className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-5 text-[14px] text-slate-700">
                {[t("Onlayn bron — mijozlar Chronix ilovasidan 24/7 yoziladi"),
                  t("Kalendar, xodimlar, kassa, ombor va hisobotlar bitta panelda"),
                  t("Eslatmalar, sharhlar va aksiyalar — mijozlar qaytib keladi")].map((x) => (
                  <li key={x} className="flex gap-2.5"><Check size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />{x}</li>
                ))}
              </ul>
              {verified ? (
                <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                  <Check size={18} aria-hidden />{t("Telefon tasdiqlandi: {a}", { a: verified.phone ?? "" })}
                </p>
              ) : tg ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-center">
                  <p className="text-[15px] font-semibold text-slate-900">{t("Telegram'da tasdiqlang")}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("Ochilgan botda «Raqamni yuborish» tugmasini bosing. Tasdiqlangach shu yerda davom etasiz.")}
                  </p>
                  <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <span className="size-2 animate-pulse rounded-full bg-sky-500" />{t("Kutilmoqda...")}
                  </div>
                  <a href={tg.url} target="_blank" rel="noreferrer"
                    className="mt-3 inline-block rounded-lg bg-[#229ED9] px-4 py-2 text-sm font-medium text-white hover:bg-[#1E8DC2]">
                    {t("Botni ochish")}
                  </a>
                </div>
              ) : (
                <button type="button" onClick={startTelegram} disabled={busy}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#229ED9] text-[15px] font-semibold text-white shadow-sm transition hover:bg-[#1E8DC2] disabled:opacity-60">
                  {t("Telefonni Telegram orqali tasdiqlash")}
                </button>
              )}
              <p className="text-center text-xs text-slate-500">
                {t("Telefon raqamingiz Telegram bot orqali tasdiqlanadi — SMS kerak emas.")}
              </p>
            </>
          )}

          {step === 1 && (
            <>
              <label className="block text-sm font-medium text-slate-700">{t("Ism va familiya")}
                <input className={field} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus
                  autoComplete="name" maxLength={120} required />
              </label>
              <label className="block text-sm font-medium text-slate-700">{t("Telefon")}
                <input className={`${field} bg-slate-50 text-slate-500`} value={verified?.phone ?? ""} disabled />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {verified?.has_password ? t("Joriy parolingiz") : t("Parol (kamida 8 belgi)")}
                <PasswordField className={field} value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete={verified?.has_password ? "current-password" : "new-password"} minLength={8} required />
              </label>
              {verified?.has_password && (
                <p className="text-[13px] text-slate-500">{t("Bu raqam bilan hisob bor — o'sha parolni kiriting.")}</p>
              )}
            </>
          )}

          {step === 2 && (categories.data ?? []).map((c) => (
            <Choice key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}
              icon={ICONS[c.slug] ?? Store} title={getLang() === "ru" && c.name_ru ? c.name_ru : c.name_uz} />
          ))}

          {step === 3 && TEAM.map((x) => (
            <Choice key={x.value} active={team === x.value} onClick={() => setTeam(x.value)}
              icon={x.value === "1" ? User : Users} title={x.label} hint={x.hint} />
          ))}

          {step === 4 && (
            <>
              <label className="block text-sm font-medium text-slate-700">{t("Muassasa nomi")}
                <input className={field} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120}
                  placeholder={t("Masalan: Malika Beauty")} required />
              </label>
              <label className="block text-sm font-medium text-slate-700">{t("Viloyat")}
                <select className={field} value={region} onChange={(e) => { setRegion(e.target.value); setCity(""); }} required>
                  <option value="">{t("Tanlang")}</option>
                  {(regions.data ?? []).map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">{t("Shahar yoki tuman")}
                <select className={field} value={city} onChange={(e) => setCity(e.target.value)} disabled={!region}>
                  <option value="">{t("Tanlang")}</option>
                  {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">{t("Manzil")}
                <input className={field} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300}
                  placeholder={t("Ko'cha, uy (xaritadagi joyni keyin panelda belgilaysiz)")} />
              </label>
              <label className="block text-sm font-medium text-slate-700">{t("Muassasa telefoni")}
                <input className={field} value={contact} onChange={(e) => setContact(e.target.value)} inputMode="tel"
                  placeholder={verified?.phone ?? "+998"} />
              </label>
            </>
          )}

          {error != null && <ErrorNote error={error} />}
        </div>

        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
            {step > 0 && (
              <button type="button" onClick={() => { setError(null); setStep(step - 1); }}
                className="flex h-12 items-center gap-1.5 rounded-xl border border-slate-200 px-4 text-[15px] font-medium text-slate-700 hover:bg-slate-50">
                <ArrowLeft size={18} aria-hidden />{t("Orqaga")}
              </button>
            )}
            <button type="submit" disabled={!canNext || busy}
              className="h-12 flex-1 rounded-xl bg-slate-900 text-[15px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              {step === STEPS - 1 ? t("Arizani yuborish") : t("Davom etish")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
