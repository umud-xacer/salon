// Telefon kimniki: bitta telefon = bitta odam (bitta login, bitta ism).
// Super Admin ikki muassasaga bitta raqamni yozsa, u bitta odam bo'ladi va ismi ikkalasida bir xil o'zgaradi —
// forma buni oldindan aytadi.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../../api/client";
import { normalizePhone } from "../../components/format";

import { t } from "../../i18n";
export interface PhoneLookup {
  phone: string;
  exists: boolean;
  full_name: string | null;
  memberships: { business_id: number; business_name: string; role: string }[];
}

const ROLE: Record<string, string> = { owner: "direktor", manager: "menejer", receptionist: "qabulxona", staff: "xodim" };

export function usePhoneLookup(phone: string) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setValue(phone.replace(/\D/g, "").length >= 9 ? normalizePhone(phone) : ""), 350);
    return () => clearTimeout(t);
  }, [phone]);
  return useQuery({
    queryKey: ["superadmin", "phone-lookup", value],
    queryFn: () => api<PhoneLookup>(`/superadmin/phone-lookup?phone=${encodeURIComponent(value)}`),
    enabled: value.length >= 12,
    staleTime: 10_000,
  });
}

/** mode: "rename" — shu odamning ismi tuzatilyapti; "assign" — bu raqam direktor qilib yozilyapti */
export function PhoneOwnerHint({ lookup, businessId, mode }: {
  lookup: PhoneLookup | undefined; businessId?: number; mode: "rename" | "assign";
}) {
  if (!lookup?.exists) return null;
  const others = lookup.memberships.filter((m) => m.business_id !== businessId);
  const where = others.map((m) => `${m.business_name} (${ROLE[m.role] ?? m.role})`).join(", ");
  if (mode === "rename") {
    if (others.length === 0) return null;
    return (
      <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
        {t("Diqqat: bu telefon bitta odamniki va u yana {a} ta muassasada bor: {b}. Ism hammasida birdan o'zgaradi. Agar ular boshqa-boshqa odamlar bo'lsa, ismni tuzatmang — \"Direktorni almashtirish\" orqali boshqa odamning o'z telefon raqamini kiriting.", { a: others.length, b: where })}
      </p>
    );
  }
  return (
    <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
      {t("Bu raqam allaqachon ro'yxatda:")}{" "}<b>{lookup.full_name || "ismsiz"}</b>
      {others.length > 0 ? t(", u yana {a} ta muassasada bor: {b}", { a: others.length, b: where }) : ""}{t(". Bitta telefon — bitta odam: ismi va paroli hamma muassasada bir xil bo'ladi. Boshqa odam bo'lsa, uning o'z raqamini kiriting.")}
    </p>
  );
}
