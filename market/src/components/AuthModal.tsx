// Kirish oynasi (Fresha'dagi kabi bron oldidan chiqadi): telefon + SMS kod, Telegram, Google.
import { ArrowLeft, Phone, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, LoginOut } from "../api";
import { useAuth } from "../auth";
import { btn, ErrorText, Modal, Spinner } from "./ui";

// sms=false — telefon+SMS kod bilan kirish vaqtincha o'chiq (server SMS_LOGIN_ENABLED), faqat Telegram/Google
type AppInfo = { login_methods?: { sms?: boolean; telegram: boolean; google: boolean }; google_web_client_id?: string | null };
type Step = "choose" | "phone" | "code" | "name" | "telegram";

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    } } };
  }
}

function loadGsi(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gsi"));
    document.head.appendChild(s);
  });
}

const fmt = (d: string) => [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(" ");

export function AuthModal() {
  const { gate, closeGate, signIn, me, refresh } = useAuth();
  const [step, setStep] = useState<Step>("choose");
  const [info, setInfo] = useState<AppInfo>({});
  const [digits, setDigits] = useState("");
  const [cc, setCc] = useState("998");                   // mamlakat kodi (sql/067): 998 — O'zbekiston, 7 — Rossiya ...
  const uz = cc === "998";
  const phoneOk = uz ? digits.length === 9 : cc.length >= 1 && digits.length >= 6 && (cc + digits).length >= 10 && (cc + digits).length <= 15;
  const fullPhone = `+${cc}${digits}`;
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<"sms" | "telegram">("sms");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [tg, setTg] = useState<{ nonce: string; url: string } | null>(null);
  const googleBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gate.open) return;
    setStep("choose"); setError(null); setCode(""); setTg(null);
    api<AppInfo>("/catalog/app-info").then(setInfo)
      .catch(() => setInfo({ login_methods: { sms: true, telegram: false, google: false } }));
  }, [gate.open]);

  const done = useCallback(async (l: LoginOut) => {
    setLink(null);
    await signIn(l);
    if (l.is_new || !l.user.full_name?.trim()) { setStep("name"); return false; }
    return true;
  }, [signIn]);

  // Google tugmasi (Google Identity Services)
  useEffect(() => {
    const id = info.google_web_client_id;
    if (!gate.open || step !== "choose" || !info.login_methods?.google || !id) return;
    let alive = true;
    loadGsi().then(() => {
      if (!alive || !googleBox.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: id,
        callback: async ({ credential }) => {
          setBusy(true); setError(null);
          try {
            const r = await api<{ need_phone: boolean; link_token: string | null; login: LoginOut | null }>("/auth/google", { method: "POST", body: { id_token: credential } });
            if (r.login) { await done(r.login); }
            else { setLink(r.link_token); setStep("phone"); }
          } catch (e) { setError(e instanceof ApiError ? e.message : "Google orqali kirib bo'lmadi"); }
          finally { setBusy(false); }
        },
      });
      googleBox.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleBox.current, { theme: "outline", size: "large", shape: "pill", width: 340, text: "continue_with" });
    }).catch(() => {});
    return () => { alive = false; };
  }, [gate.open, step, info, done]);

  // Telegram: bot raqamni tasdiqlaguncha so'rab turamiz
  useEffect(() => {
    if (step !== "telegram" || !tg) return;
    let stop = false;
    const timer = setInterval(async () => {
      if (stop) return;
      try {
        const r = await api<{ status: string; login: LoginOut | null }>("/auth/telegram/poll", { method: "POST", body: { nonce: tg.nonce } });
        if (r.status === "ok" && r.login) { stop = true; clearInterval(timer); await done(r.login); }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { stop = true; clearInterval(timer); setError("Kirish so'rovi eskirgan. Qaytadan urinib ko'ring"); }
      }
    }, 2000);
    return () => { stop = true; clearInterval(timer); };
  }, [step, tg, done]);

  if (me && step !== "name") return null;
  const open = gate.open || (step === "name" && !!me);
  const smsOn = !!info.login_methods && info.login_methods.sms !== false;

  const requestCode = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ channel?: "sms" | "telegram" }>("/auth/otp/request", { method: "POST", body: { phone: fullPhone } });
      setChannel(r.channel === "telegram" ? "telegram" : "sms");
      setStep("code");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Xatolik yuz berdi"); }
    finally { setBusy(false); }
  };

  const verify = async (v: string) => {
    setBusy(true); setError(null);
    try {
      const l = await api<LoginOut>("/auth/otp/verify", { method: "POST", body: { phone: fullPhone, code: v, link_token: link ?? undefined } });
      await done(l);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Xatolik yuz berdi"); setCode(""); }
    finally { setBusy(false); }
  };

  const startTelegram = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ nonce: string; url: string }>("/auth/telegram/start", { method: "POST", body: { link_token: link ?? undefined } });
      setTg(r); setStep("telegram");
      window.open(r.url, "_blank", "noopener");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Xatolik yuz berdi"); }
    finally { setBusy(false); }
  };

  const saveName = async () => {
    setBusy(true); setError(null);
    try {
      await api("/auth/me", { method: "PATCH", body: { full_name: name.trim() } });
      await refresh();
      setStep("choose");
      closeGate();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Xatolik yuz berdi"); }
    finally { setBusy(false); }
  };

  const back = step === "phone" || step === "telegram" ? () => { setStep("choose"); setError(null); }
    : step === "code" ? () => { setStep("phone"); setCode(""); setError(null); } : null;

  return (
    <Modal open={open} onClose={() => { if (step !== "name") closeGate(); }}
      title={back ? <button onClick={back} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-soft" aria-label="Orqaga"><ArrowLeft size={20} /></button> : null}>
      {step === "choose" && (
        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-extrabold leading-tight">Bron qilish uchun kiring yoki ro'yxatdan o'ting</h2>
            <p className="mt-2 text-muted">{gate.reason}</p>
          </div>
          {link && (
            <p className="rounded-xl bg-brand-soft p-3 text-sm">
              {smsOn ? "Google hisobingizni bog'lash uchun raqamingizni bir marta tasdiqlang."
                : "Google hisobingizni bog'lash uchun raqamingizni Telegram orqali bir marta tasdiqlang."}
            </p>
          )}
          {!info.login_methods && <div className="flex justify-center"><Spinner /></div>}
          {smsOn && <button className={`${btn.primary} w-full`} onClick={() => setStep("phone")}><Phone size={18} /> Telefon raqam bilan</button>}
          {info.login_methods?.telegram && (
            <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#229ED9] font-bold text-white transition hover:brightness-95"
              onClick={startTelegram} disabled={busy}><Send size={18} /> Telegram orqali</button>
          )}
          {info.login_methods?.google && !link && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted"><i className="h-px flex-1 bg-line" />yoki<i className="h-px flex-1 bg-line" /></div>
              <div ref={googleBox} className="flex justify-center" />
            </>
          )}
          <ErrorText text={error} />
          <p className="text-center text-xs text-muted">Davom etib, <a href="/privacy" className="text-brand underline">Maxfiylik siyosati</a>ga rozilik bildirasiz</p>
        </div>
      )}

      {step === "phone" && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (phoneOk) void requestCode(); }}>
          <div>
            <h2 className="text-2xl font-extrabold">Telefon raqamingiz</h2>
            <p className="mt-2 text-muted">6 xonali tasdiqlash kodini yuboramiz</p>
          </div>
          <label className="flex h-14 items-center rounded-full border-2 border-line px-5 focus-within:border-brand">
            <span className="font-bold">+</span>
            <input inputMode="numeric" value={cc} aria-label="Mamlakat kodi" maxLength={3}
              onChange={(e) => { setCc(e.target.value.replace(/\D/g, "").slice(0, 3)); setDigits(""); }}
              className="w-11 bg-transparent font-bold outline-none" />
            <span className="mx-3 h-6 w-px bg-line" />
            <input autoFocus inputMode="numeric" value={uz ? fmt(digits) : digits} placeholder={uz ? "90 123 45 67" : "916 123 45 67"}
              aria-label="Telefon raqam"
              onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, uz ? 9 : 13))}
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
          </label>
          <ErrorText text={error} />
          <button className={`${btn.primary} w-full`} disabled={!phoneOk || busy}>{busy ? <Spinner className="border-t-white" /> : "Kod olish"}</button>
          {info.login_methods?.telegram && (
            <button type="button" onClick={startTelegram} className="w-full text-center text-sm font-semibold text-brand">SMS kelmayaptimi? Telegram orqali kiring</button>
          )}
        </form>
      )}

      {step === "code" && (
        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-extrabold">Kodni kiriting</h2>
            <p className="mt-2 text-muted">
              {channel === "telegram" ? "Kod Telegramingizga (@ChronixUzBot) yuborildi" : "Kod SMS orqali yuborildi"}: <b className="text-ink">+{cc} {uz ? fmt(digits) : digits}</b>
            </p>
          </div>
          <input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} aria-label="Tasdiqlash kodi"
            onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6) void verify(v); }}
            className="h-16 w-full rounded-2xl border-2 border-line text-center text-3xl font-extrabold tracking-[.5em] outline-none focus:border-brand" />
          <ErrorText text={error} />
          {busy && <div className="flex justify-center"><Spinner /></div>}
          <button onClick={requestCode} disabled={busy} className="w-full text-center text-sm font-semibold text-brand">Kodni qayta yuborish</button>
        </div>
      )}

      {step === "telegram" && (
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#229ED9] text-white"><Send size={28} /></div>
          <h2 className="text-2xl font-extrabold">Telegram'da tasdiqlang</h2>
          <ol className="space-y-2 rounded-2xl bg-soft p-4 text-left text-sm">
            <li>1. Ochilgan @ChronixUzBot'da <b>Start</b> ni bosing</li>
            <li>2. <b>«📱 Raqamni yuborish»</b> ni bosing</li>
            <li>3. Shu sahifaga qayting — kirish avtomatik bo'ladi</li>
          </ol>
          {!error && <div className="flex items-center justify-center gap-2 text-sm text-muted"><Spinner /> Tasdiqlash kutilmoqda…</div>}
          <ErrorText text={error} />
          {tg && <a href={tg.url} target="_blank" rel="noopener" className={`${btn.outline} w-full`}>Telegram'ni qayta ochish</a>}
        </div>
      )}

      {step === "name" && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) void saveName(); }}>
          <div>
            <h2 className="text-2xl font-extrabold">Ismingiz qanday?</h2>
            <p className="mt-2 text-muted">Salon sizni shu ism bilan ko'radi</p>
          </div>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ism Familiya" maxLength={120}
            className="h-14 w-full rounded-full border-2 border-line px-5 text-lg font-semibold outline-none focus:border-brand" />
          <ErrorText text={error} />
          <button className={`${btn.primary} w-full`} disabled={name.trim().length < 2 || busy}>Davom etish</button>
        </form>
      )}
    </Modal>
  );
}
