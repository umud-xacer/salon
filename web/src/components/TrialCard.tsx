// O'zi ro'yxatdan o'tgan muassasa: tasdiqni kutish sahifasi va sinov davomida "ilovaga chiqish" ro'yxati.
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Clock, Hourglass } from "lucide-react";
import { Link } from "react-router-dom";

import { businessOnboarding, type Readiness } from "../api/onboarding";
import type { Membership } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { sectionsFor, sectionUrl } from "../modules/registry";
import { formatDate } from "./format";
import { Button } from "./ui";
import { t } from "../i18n";

// section — registry'dagi bo'lim (manzil muassasa turiga qarab: xodimlar / shifokorlar, salon / klinika)
const STEPS: { key: keyof Readiness; label: string; section: string }[] = [
  { key: "services", label: t("Xizmatlar va narxlar qo'shildi"), section: "services" },
  { key: "staff", label: t("Mutaxassis qo'shildi va xizmatlari belgilandi"), section: "staff" },
  { key: "hours", label: t("Ish vaqti belgilandi"), section: "business" },
  { key: "location", label: t("Xaritada manzil belgilandi"), section: "business" },
  { key: "visible", label: t("Chronix ilovasida mijozlarga ko'rinmoqda"), section: "business" },
];

/** Super Admin tasdiqlaguncha panel o'rniga */
export function PendingSignupPage({ membership: m }: { membership: Membership }) {
  const { signOut, refresh } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <Hourglass size={28} aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-bold text-slate-900">{t("Arizangiz ko'rib chiqilmoqda")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("«{a}» uchun ariza qabul qilindi. Chronix jamoasi uni odatda bir ish kuni ichida tasdiqlaydi.", { a: m.business_name })}
        </p>
        <ol className="mt-5 space-y-2.5 rounded-2xl bg-slate-50 p-4 text-left text-sm text-slate-700">
          <li className="flex gap-2"><CheckCircle2 size={18} className="shrink-0 text-emerald-600" aria-hidden />{t("Ariza yuborildi")}</li>
          <li className="flex gap-2"><Clock size={18} className="shrink-0 text-amber-600" aria-hidden />{t("Tasdiqlash — Telegram orqali xabar olasiz")}</li>
          <li className="flex gap-2"><Circle size={18} className="shrink-0 text-slate-400" aria-hidden />{t("5 kunlik bepul sinov: xizmat, xodim va manzilni qo'shasiz")}</li>
        </ol>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => void refresh?.()}>{t("Holatni yangilash")}</Button>
          <Button variant="secondary" onClick={() => void signOut()}>{t("Chiqish")}</Button>
        </div>
      </div>
    </div>
  );
}

/** Sinov davomida panel tepasida: qolgan kunlar va ilovaga chiqish uchun qadamlar (faqat direktor) */
export function TrialCard({ membership: m, base }: { membership: Membership; base: string }) {
  const q = useQuery({
    queryKey: ["onboarding", m.business_id],
    queryFn: () => businessOnboarding(m.business_id),
    enabled: m.role === "owner",
    staleTime: 60_000,
  });
  const o = q.data;
  if (!o || o.status !== "trial" || !o.readiness) return null;
  const r = o.readiness;
  const done = STEPS.filter((s) => r[s.key]).length;
  const ready = r.all_filled && r.visible;
  const sections = sectionsFor(m);
  const href = (key: string) => {
    const sec = sections.find((x) => x.path === key);
    return sec ? `${base}/${sectionUrl(sec, m.business_kind)}` : base;
  };
  return (
    <div className={`mx-4 mt-4 rounded-2xl border p-4 sm:mx-6 ${ready ? "border-emerald-200 bg-emerald-50/60" : "border-blue-200 bg-blue-50/60"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[15px] font-semibold text-slate-900">
          {t("Bepul sinov: {a} kun qoldi", { a: o.days_left ?? 0 })}
        </p>
        {o.trial_ends_at && <span className="text-xs text-slate-500">{t("{a} gacha", { a: formatDate(o.trial_ends_at) })}</span>}
        <span className="ml-auto text-xs font-medium text-slate-600">{t("{a}/{b} bajarildi", { a: done, b: STEPS.length })}</span>
      </div>
      <p className="mt-1 text-[13px] text-slate-600">
        {ready ? t("Hammasi tayyor — muassasangiz ilovada ko'rinmoqda. Sinovdan keyin oylik obuna boshlanadi.")
          : t("Sinov tugaguncha quyidagilarni bajaring, aks holda muassasa avtomatik o'chiriladi.")}
      </p>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {STEPS.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[13px]">
            {r[s.key] ? <CheckCircle2 size={16} className="shrink-0 text-emerald-600" aria-hidden />
              : <Circle size={16} className="shrink-0 text-slate-400" aria-hidden />}
            {r[s.key] ? <span className="text-slate-500 line-through">{s.label}</span>
              : <Link to={href(s.section)} className="font-medium text-blue-700 hover:underline">{s.label}</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}
