// Panelga kirish: Telegram va Google (tezkor) + telefon raqam (parol yoki SMS kod).
// Telegram/Google orqali panelga faqat muassasaga qo'shilgan direktor/xodim kiradi — yangi mijoz yaratilmaydi
// (server: panel=true, sql/063). Google hisobi hali bog'lanmagan bo'lsa — bir marta telefon bilan kirib bog'lanadi.
import { useEffect, useRef, useState, type FormEvent } from "react";

import { googleLogin, loginMethods, loginWithPassword, requestOtp, telegramPoll, telegramStart, verifyOtp,
         type LoginMethods } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { normalizePhone } from "../components/format";
import { Button, ErrorNote } from "../components/ui";
import { isAdminHost } from "../panelHost";
import { PasswordField } from "../components/PasswordField";
import { getLang, LangSwitch, t } from "../i18n";

const input = "w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-primary";

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
  const googleBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loginMethods().then(setMethods).catch(() => setMethods({}));
  }, []);

  // Google tugmasi (Google Identity Services). Bog'lash yoki Telegram kutish paytida ko'rsatilmaydi
  const googleId = methods?.login_methods?.google ? methods.google_web_client_id : null;
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
      if (mode === "password") {
        await signIn(await loginWithPassword(p, password, link));
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
  const quick = (tgOn || !!googleId) && !link;

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6">
        <div className="-mt-2 mb-2 flex justify-end"><LangSwitch /></div>
        <div className="mb-5 flex flex-col items-center text-center">
          <img src="/logo.jpg" alt={t("Chronix")} className="mb-3 size-24 rounded-2xl object-cover" />
          <h1 className="text-lg font-semibold text-navy">
            {isAdminHost ? t("Chronix — Super Admin paneli") : t("Chronix paneliga kirish")}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {isAdminHost ? t("Faqat platforma boshqaruvchisi uchun")
              : t("Salon, klinika va spa markazlari rahbarlari va xodimlari uchun")}
          </p>
        </div>

        {tg ? (
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
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#229ED9] text-sm font-medium text-white transition hover:bg-[#1E8DC2] disabled:opacity-60">
                    <TelegramIcon /> {t("Telegram orqali kirish")}
                  </button>
                )}
                {googleId && <div ref={googleBox} className="flex min-h-11 w-full justify-center" />}
                <div className="flex items-center gap-3 py-1 text-xs text-muted">
                  <span className="h-px flex-1 bg-line" />{t("yoki telefon raqam bilan")}<span className="h-px flex-1 bg-line" />
                </div>
              </div>
            )}
            {error != null && quick && <div className="mb-3"><ErrorNote error={error} /></div>}

            <div className="mb-4 mt-1 grid grid-cols-2 rounded-lg bg-page p-1 text-sm">
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
            </div>

            <form onSubmit={submit} className="space-y-3">
              <label className="block text-sm">
                {t("Telefon")}
                <input
                  className={`${input} mt-1`}
                  type="tel"
                  autoComplete="tel"
                  placeholder="+998 90 123 45 67"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>

              {mode === "password" && (
                <label className="block text-sm">
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

              {mode === "sms" && codeSent && (
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
              <Button type="submit" disabled={busy} className="w-full">
                {mode === "sms" && !codeSent ? t("Kod yuborish") : link ? t("Kirish va Google'ni ulash") : t("Kirish")}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
