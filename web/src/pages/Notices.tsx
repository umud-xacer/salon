import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import type { Membership } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { ChangePasswordForm } from "../components/ChangePasswordDialog";
import { formatDate } from "../components/format";
import { Button } from "../components/ui";

import { t } from "../i18n";
function Notice({ title, children }: { title: string; children: ReactNode }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center">
        <Lock className="mx-auto mb-3 text-primary" size={32} aria-hidden />
        <h1 className="text-lg font-semibold text-navy">{title}</h1>
        <div className="mt-2 space-y-2 text-sm text-muted">{children}</div>
        <Button variant="secondary" className="mt-5" onClick={() => void signOut()}>
          {t("Chiqish")}
        </Button>
      </div>
    </div>
  );
}

/** Salon to'xtatilganda panel o'rniga. Ma'lumot saqlangani aytiladi: egasi xavotirga tushmasin. */
export function SuspendedPage({ membership: m }: { membership: Membership }) {
  if (m.business_status === "blocked") {
    return (
      <Notice title={t("{a} bloklangan", { a: m.business_name })}>
        <p>{t("Ma'lumotlaringiz saqlangan. Sababini bilish uchun Chronix bilan bog'laning.")}</p>
      </Notice>
    );
  }
  const expired = m.subscription_ends_at !== null && new Date(m.subscription_ends_at) <= new Date();
  return (
    <Notice title={t("Obuna to'xtatilgan")}>
      <p>
        {m.business_name}
        {expired ? t(" obunasi {a} kuni tugagan.", { a: formatDate(m.subscription_ends_at!) }) : t(" obunasi to'xtatilgan.")}
      </p>
      <p>{t("Barcha ma'lumotlaringiz saqlangan. To'lovdan keyin ish shu joyidan davom etadi.")}</p>
    </Notice>
  );
}

export function ForcePasswordPage() {
  return (
    <Notice title={t("Parolni almashtiring")}>
      <p>{t("Sizga vaqtinchalik parol berilgan. Davom etish uchun o'zingiz bilgan yangi parol qo'ying.")}</p>
      <div className="mt-4">
        <ChangePasswordForm forced />
      </div>
    </Notice>
  );
}

export function ClientOnlyPage() {
  return (
    <Notice title={t("Panel xodimlar uchun")}>
      <p>{t("Bu raqam hech qaysi muassasaga xodim sifatida ulanmagan. Mijozlar Chronix mobil ilovasidan foydalanadi.")}</p>
    </Notice>
  );
}
