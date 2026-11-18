// Panelga kirish: Telegram va Google (tezkor) + telefon raqam (parol yoki SMS kod).
// Telegram/Google orqali panelga faqat muassasaga qo'shilgan direktor/xodim kiradi — yangi mijoz yaratilmaydi
// (server: panel=true, sql/063). Google hisobi hali bog'lanmagan bo'lsa — bir marta telefon bilan kirib bog'lanadi.
import { useEffect, useRef, useState, type FormEvent } from "react";

import { googleLogin, loginMethods, loginWithPassword, requestOtp, telegramPoll, telegramStart, twofaResend,
         twofaVerify, verifyOtp, type LoginMethods, type TwoFactor } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { normalizePhone } from "../components/format";
import { ErrorNote } from "../components/ui";
import { isAdminHost } from "../panelHost";
import { PasswordField } from "../components/PasswordField";
import { getLang, LangSwitch, t } from "../i18n";

const input = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 shadow-sm outline-none "
  + "transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15";
const FONT = { fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" };

// Inter shrifti faqat kirish oynasi uchun (panelning qolgan qismi tizim shriftida)
function useInterFont() {
  useEffect(() => {
    if (document.getElementById("inter-font")) return;
    const l = document.createElement("link");
    l.id = "inter-font";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }, []);
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    } } };
  }
}

let gisLoading: Promise<void> | null = null;
function loadGoogle(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoading = null; reject(new Error("gsi")); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <path d="M21.9 4.6 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6.1 13.1 1.2 11.6c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.6z" />
    </svg>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"password" | "sms">("password");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [methods, setMethods] = useState<LoginMethods | null>(null);
  const [link, setLink] = useState<string | null>(null);          // Google bog'lash tokeni (15 daqiqa)
  const [tg, setTg] = useState<{ nonce: string; url: string } | null>(null);
  // Super Admin 2FA (sql/065): parol to'g'ri — kod Telegramga ketdi, token kod tasdiqlangach
  const [twofa, setTwofa] = useState<{ challenge: string; expiresAt: number; resendAt: number } | null>(null);
  const [twofaCode, setTwofaCode] = useState("");
  const [now, setNow] = useState(Date.now());
  const googleBox = useRef<HTMLDivElement>(null);
  useInterFont();

  useEffect(() => {
    loginMethods().then(setMethods).catch(() => setMethods({}));
  }, []);

  useEffect(() => {
    if (!twofa) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [twofa]);

  const startTwofa = (r: TwoFactor) => {
    const t0 = Date.now();
    setNow(t0);
    setTwofaCode("");
    setTwofa({ challenge: r.challenge, expiresAt: t0 + r.expires_in * 1000, resendAt: t0 + r.resend_in * 1000 });
  };

  async function confirmTwofa(e: FormEvent) {
    e.preventDefault();
    if (!twofa) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(await twofaVerify(twofa.challenge, twofaCode.trim()));
    } catch (err) {
      setError(err);
      setTwofaCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resendTwofa() {
    if (!twofa) return;
    setBusy(true);
    setError(null);
    try {
      startTwofa(await twofaResend(twofa.challenge));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  // Google tugmasi (Google Identity Services). Bog'lash yoki Telegram kutish paytida ko'rsatilmaydi
  // Super Admin Google bilan kirmaydi (2FA): ega.chronix.uz da tugma yo'q
  const googleId = methods?.login_methods?.google && !isAdminHost ? methods.google_web_client_id : null;
  useEffect(() => {
    if (!googleId || link || tg) return;
    let alive = true;
    loadGoogle().then(() => {
      if (!alive || !googleBox.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: googleId,
        callback: async ({ credential }) => {
          setError(null);
          setBusy(true);
          try {
            const r = await googleLogin(credential);
            if (r.login) await signIn(r.login);
            else if (r.link_token) setLink(r.link_token);
          } catch (e) { setError(e); } finally { setBusy(false); }
        },
      });
      googleBox.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleBox.current, {
        theme: "outline", size: "large", shape: "rectangular", width: googleBox.current.offsetWidth || 336,
        text: "signin_with", logo_alignment: "center", locale: getLang() === "ru" ? "ru" : "uz",
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [googleId, link, tg, signIn]);

  // Telegram: bot raqamni tasdiqlaguncha har 2 soniyada so'raladi
  useEffect(() => {
    if (!tg) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const r = await telegramPoll(tg.nonce);
        if (!alive || r.status !== "ok" || !r.login) return;
        window.clearInterval(timer);
        await signIn(r.login);
      } catch (e) {
        window.clearInterval(timer);
        if (alive) { setTg(null); setError(e); }
      }
    }, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [tg, signIn]);

  async function startTelegram() {
    setError(null);
    const win = window.open("", "_blank");             // bosish paytida ochiladi — brauzer bloklamaydi
    try {
      const r = await telegramStart();
      if (win) win.location.href = r.url; else window.location.assign(r.url);
      setTg({ nonce: r.nonce, url: r.url });
    } catch (e) {
      win?.close();
      setError(e);
    }
  }

  const switchMode = (next: "password" | "sms") => {
    setMode(next);
    setError(null);
    setCodeSent(false);
    setDevCode(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = normalizePhone(phone);
      if (formMode === "password") {
        const r = await loginWithPassword(p, password, link);
        if ("need_2fa" in r) startTwofa(r);
        else await signIn(r);
      } else if (!codeSent) {
        const r = await requestOtp(p);
        setCodeSent(true);
        setDevCode(r.dev_code);
      } else {
        await signIn(await verifyOtp(p, code, link));
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const tgOn = !!methods?.login_methods?.telegram;
  // SMS shlyuz o'chiq (server SMS_LOGIN_ENABLED=false) — "SMS kod" tabi yashiriladi, faqat parol.
  // SMS yoqilsa tab o'zi qaytadi: kod o'chirilmagan.
  const smsOn = methods?.login_methods?.sms === true;
  const formMode = smsOn ? mode : "password";
  const quick = (tgOn || !!googleId) && !link;

  return (
    <div style={FONT} className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050B24] p-4 antialiased">
      {/* Fon: chuqur ko'k gradient, yumshoq nur dog'lari va nozik to'r */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,#1E3A8A_0%,#0B1437_45%,#050B24_100%)]" />
      <div aria-hidden className="pointer-events-none absolute -left-32 top-1/4 size-96 rounded-full bg-blue-600/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-24 bottom-0 size-80 rounded-full bg-indigo-500/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

      <div className="relative w-full max-w-[400px] rounded-2xl border border-white/60 bg-white p-7 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04),0_0_0_1px_rgba(15,23,42,0.04)] sm:p-8">
        <div className="-mt-2 mb-1 flex justify-end"><LangSwitch /></div>
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative mb-4">
            <div aria-hidden className="absolute -inset-3 rounded-[28px] bg-blue-500/25 blur-xl" />
            <div aria-hidden className="absolute -inset-1 rounded-[22px] bg-gradient-to-b from-blue-400/40 to-indigo-600/20" />
            <img src="/logo.jpg" alt={t("Chronix")} className="relative size-20 rounded-[18px] object-cover shadow-lg shadow-blue-900/30 ring-1 ring-white/20" />
          </div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
            {isAdminHost ? t("Chronix — Super Admin paneli") : t("Chronix paneliga kirish")}
          </h1>
          <p className="mt-1.5 text-[13px] leading-snug text-slate-500">
            {isAdminHost ? t("Faqat platforma boshqaruvchisi uchun")
              : t("Salon, klinika va spa markazlari rahbarlari va xodimlari uchun")}
          </p>
        </div>

        {twofa ? (
          <form onSubmit={confirmTwofa} className="space-y-4">
            <div className="text-center">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-gradient-to-b from-[#3AB3EA] to-[#1C93D2] text-white shadow-md"><TelegramIcon /></div>
              <p className="text-[15px] font-semibold text-slate-900">{t("Ikki bosqichli tasdiqlash")}</p>
              <p className="mt-1 text-sm text-slate-500">{t("Telegram botingizga tasdiqlash kodi yuborildi. Kodni kiriting:")}</p>
            </div>
            <input className={`${input} text-center text-2xl font-semibold tracking-[0.5em]`} inputMode="numeric"
              autoComplete="one-time-code" autoFocus maxLength={6} pattern="\d{6}" required aria-label={t("Tasdiqlash kodi")}
              value={twofaCode} onChange={(e) => setTwofaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            <p className="text-center text-xs text-slate-500">
              {twofa.expiresAt > now
                ? t("Kod amal qiladi: {a}", { a: `${Math.floor((twofa.expiresAt - now) / 60000)}:${String(Math.floor(((twofa.expiresAt - now) % 60000) / 1000)).padStart(2, "0")}` })
                : t("Kod muddati o'tdi — yangisini so'rang")}
            </p>
            {error != null && <ErrorNote error={error} />}
            <button type="submit" disabled={busy || twofaCode.length !== 6 || twofa.expiresAt <= now}
              className="relative flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-b from-[#3B7BF0] via-[#1D61E7] to-[#1849B8] text-[15px] font-semibold text-white shadow-[0_10px_24px_-8px_rgba(29,97,231,0.65)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
              {t("Tasdiqlash va kirish")}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={() => { setTwofa(null); setError(null); }} className="text-slate-500 hover:text-slate-800">{t("Orqaga")}</button>
              <button type="button" onClick={resendTwofa} disabled={busy || twofa.resendAt > now}
                className="font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
                {twofa.resendAt > now ? t("Qayta yuborish ({a} s)", { a: Math.ceil((twofa.resendAt - now) / 1000) }) : t("Kodni qaytadan yuborish")}
              </button>
            </div>
          </form>
        ) : tg ? (
          <div className="space-y-3 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#229ED9] text-white"><TelegramIcon /></div>
            <p className="text-sm font-medium text-navy">{t("Telegram'da tasdiqlang")}</p>
            <p className="text-sm text-muted">
              {t("Ochilgan botda «Raqamni yuborish» tugmasini bosing. Tasdiqlangach, panel shu yerda o'zi ochiladi.")}
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted">
              <span className="size-2 animate-pulse rounded-full bg-[#229ED9]" />{t("Kutilmoqda...")}
            </div>
            <a href={tg.url} target="_blank" rel="noreferrer"
              className="block rounded-lg bg-[#229ED9] py-2.5 text-sm font-medium text-white hover:bg-[#1E8DC2]">
              {t("Telegram'ni ochish")}
            </a>
            <button type="button" onClick={() => setTg(null)} className="text-sm text-muted hover:text-navy">{t("Bekor qilish")}</button>
          </div>
        ) : (
          <>
            {link && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">{t("Bu Google akkaunt hali biznes profilga ulanmagan")}</p>
                <p className="mt-1 text-xs">
                  {t("Ulash uchun direktor yoki xodim sifatida qo'shilgan telefon raqamingiz bilan bir marta kiring. Keyingi safar Google tugmasi bilan kirasiz.")}
                </p>
                <button type="button" onClick={() => setLink(null)} className="mt-2 text-xs font-medium underline">{t("Bekor qilish")}</button>
              </div>
            )}

            {quick && (
              <div className="space-y-2.5">
                {tgOn && (
                  <button type="button" onClick={startTelegram} disabled={busy}
                    className="group relative flex h-12 w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl bg-gradient-to-b from-[#3AB3EA] to-[#1C93D2] text-[15px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(34,158,217,0.6),inset_0_1px_0_rgba(255,255,255,0.3)] transition hover:-translate-y-px hover:shadow-[0_12px_24px_-6px_rgba(34,158,217,0.7),inset_0_1px_0_rgba(255,255,255,0.3)] active:translate-y-0 disabled:opacity-60">
                    <span aria-hidden className="absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/25 blur-sm transition-all duration-700 group-hover:left-[130%]" />
                    <TelegramIcon /> {isAdminHost ? t("Telegram'ni bog'lash") : t("Telegram orqali kirish")}
                  </button>
                )}
                {googleId && (
                  <div className="group relative h-12 w-full">
                    <div aria-hidden className="pointer-events-none flex h-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white text-[15px] font-semibold text-slate-700 shadow-sm transition group-hover:-translate-y-px group-hover:border-slate-300 group-hover:bg-slate-50 group-hover:shadow-md">
                      <GoogleLogo /> {t("Google orqali kirish")}
                    </div>
                    {/* Haqiqiy Google tugmasi (Google Identity Services) — deyarli shaffof qatlam, bosishni u qabul qiladi */}
                    <div ref={googleBox} className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl opacity-[0.011]" />
                  </div>
                )}
                <div className="flex items-center gap-3 py-2 text-xs font-medium text-slate-400">
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-200" />{t("yoki telefon raqam bilan")}<span className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-200" />
                </div>
              </div>
            )}
            {error != null && quick && <div className="mb-3"><ErrorNote error={error} /></div>}

            {smsOn && <div className="mb-4 mt-1 grid grid-cols-2 rounded-lg bg-page p-1 text-sm">
              {(["password", "sms"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`rounded-md py-1.5 ${mode === m ? "bg-white font-medium shadow-sm" : "text-muted"}`}
                >
                  {m === "password" ? t("Parol") : t("SMS kod")}
                </button>
              ))}
            </div>}

            <form onSubmit={submit} className="space-y-4">
              <label className="block text-[13px] font-medium text-slate-700">
                {t("Telefon")}
                <input
                  className={`${input} mt-1.5`}
                  type="tel"
                  autoComplete="tel"
                  placeholder="+998 90 123 45 67"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>

              {formMode === "password" && (
                <label className="block text-[13px] font-medium text-slate-700">
                  {t("Parol")}
                  <PasswordField
                    className={input}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}

              {formMode === "sms" && codeSent && (
                <label className="block text-sm">
                  {t("SMS kod")}
                  <input
                    className={`${input} mt-1`}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  {devCode && <span className="mt-1 block text-xs text-muted">{t("Sinov kodi: {code}", { code: devCode })}</span>}
                </label>
              )}

              {error != null && !quick && <ErrorNote error={error} />}
              <button type="submit" disabled={busy}
                className="relative mt-1 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-b from-[#3B7BF0] via-[#1D61E7] to-[#1849B8] text-[15px] font-semibold text-white shadow-[0_10px_24px_-8px_rgba(29,97,231,0.65),inset_0_1px_0_rgba(255,255,255,0.25)] transition hover:-translate-y-px hover:brightness-110 hover:shadow-[0_14px_28px_-8px_rgba(29,97,231,0.75),inset_0_1px_0_rgba(255,255,255,0.25)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/30 active:translate-y-0 active:shadow-[0_4px_12px_-4px_rgba(29,97,231,0.6)] disabled:cursor-not-allowed disabled:opacity-60">
                {busy && <span aria-hidden className="mr-2 size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {formMode === "sms" && !codeSent ? t("Kod yuborish") : link ? t("Kirish va Google'ni ulash") : t("Kirish")}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
