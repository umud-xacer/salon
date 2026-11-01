import { useState, type FormEvent } from "react";

import { loginWithPassword, requestOtp, verifyOtp } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Button, ErrorNote } from "../components/ui";

const input = "w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-primary";

// "90 123 45 67" ham, "+998901234567" ham qabul qilinadi
function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 9 ? `+998${digits}` : `+${digits}`;
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
        await signIn(await loginWithPassword(p, password));
      } else if (!codeSent) {
        const r = await requestOtp(p);
        setCodeSent(true);
        setDevCode(r.dev_code);
      } else {
        await signIn(await verifyOtp(p, code));
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6">
        <div className="mb-5 flex flex-col items-center text-center">
          <img src="/logo.jpg" alt="Chronix" className="mb-3 size-24 rounded-2xl object-cover" />
          <h1 className="text-lg font-semibold text-navy">Chronix paneliga kirish</h1>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-lg bg-page p-1 text-sm">
          {(["password", "sms"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded-md py-1.5 ${mode === m ? "bg-white font-medium shadow-sm" : "text-muted"}`}
            >
              {m === "password" ? "Parol" : "SMS kod"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            Telefon
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
              Parol
              <input
                className={`${input} mt-1`}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          {mode === "sms" && codeSent && (
            <label className="block text-sm">
              SMS kod
              <input
                className={`${input} mt-1`}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              {devCode && <span className="mt-1 block text-xs text-muted">Sinov kodi: {devCode}</span>}
            </label>
          )}

          {error != null && <ErrorNote error={error} />}
          <Button type="submit" disabled={busy} className="w-full">
            {mode === "sms" && !codeSent ? "Kod yuborish" : "Kirish"}
          </Button>
        </form>
      </div>
    </div>
  );
}
