import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";

import { api } from "../../api/client";
import type { Member, Membership } from "../../api/types";
import { PageTitle } from "../../components/ui";
import { vocabFor } from "../vocab";
import { MembersPanel } from "./MembersPanel";

import { t } from "../../i18n";
export function StaffPage({ membership }: { membership: Membership }) {
  return (
    <>
      <PageTitle title={vocabFor(membership.business_kind).staff} hint={t("Rollar, huquqlar, xizmatlar va parollar")} />
      <ReceptionModeNote membership={membership} />
      <MembersPanel businessId={membership.business_id} canManageManagers={membership.role === "owner"} />
    </>
  );
}

/** Qabulxona rejimi: faol Administrator bor-yo'qligiga qarab xodimlar nima qila olishi (ro'yxat bilan birga yangilanadi) */
function ReceptionModeNote({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const v = vocabFor(membership.business_kind);
  const members = useQuery({ queryKey: ["members", b], queryFn: () => api<Member[]>(`/businesses/${b}/members`) });
  if (!members.data) return null;
  const on = members.data.some((m) => m.role === "receptionist" && m.is_active);
  return (
    <p className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-muted">
      <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
      {on
        ? t("{a} bor: yangi bronlar va to'lovlarni faqat u (va siz) qabul qiladi. {b} faqat o'z jadvali, bronlari va mijozlarini ko'radi.",
            { a: v.receptionOne, b: v.staff })
        : t("{a} yo'q: {b} o'z kalendariga bron qo'sha oladi va o'z mijozidan to'lov oladi. {a} qo'shsangiz, bu imkoniyat avtomatik yopiladi.",
            { a: v.receptionOne, b: v.staff })}
    </p>
  );
}
