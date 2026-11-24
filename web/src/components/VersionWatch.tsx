// Panelning yangi versiyasi chiqdimi — tekshiradi (2026-11-24). Telefon brauzeri ochiq qolgan sahifani xotiradan
// tiklaydi va eski JS ishlayveradi (masalan, Super Admin kirishida raqam tanlash oynasi chiqmagan). index.html
// keshlanmaydi, shuning uchun undagi /assets/index-<xesh>.js joriy skript bilan solishtiriladi:
// kirilmagan (kirish sahifasi) — o'zi yangilanadi; kirilgan — pastda "Yangilash" eslatmasi (yozilayotgan forma yo'qolmasin).
import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { t } from "../i18n";

const ASSET = /\/assets\/index-[\w-]+\.js/;
const EVERY_MS = 10 * 60_000;

function currentBundle(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return el?.getAttribute("src")?.match(ASSET)?.[0] ?? null;
}

export function VersionWatch() {
  const { me } = useAuth();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return;                                   // ishlab chiqish rejimi (vite dev) — tekshirilmaydi
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const html = await (await fetch("/", { cache: "no-store" })).text();
        const latest = html.match(ASSET)?.[0];
        if (latest && latest !== mine) {
          if (!me) window.location.reload();
          else setStale(true);
        }
      } catch {
        // internet yo'q — keyingi safar
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = window.setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [me]);

  if (!stale) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-3 z-[1000] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
      <span className="flex-1">{t("Panelning yangi versiyasi chiqdi")}</span>
      <button type="button" onClick={() => window.location.reload()}
        className="rounded-lg bg-white px-3 py-1.5 font-semibold text-slate-900 hover:bg-slate-100">
        {t("Yangilash")}
      </button>
    </div>
  );
}
