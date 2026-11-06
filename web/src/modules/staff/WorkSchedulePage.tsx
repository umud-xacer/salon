import { useState } from "react";

import type { Membership } from "../../api/types";
import { Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";
import { useMembers } from "./MembersPanel";
import { ScheduleEditor } from "./ScheduleEditor";
import { useVocab } from "../vocab";

import { t } from "../../i18n";
export function WorkSchedulePage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const v = useVocab();
  const members = useMembers(b);
  const masters = members.data?.filter((m) => m.is_active && m.is_bookable) ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const memberId = picked ?? masters[0]?.id ?? null;

  return (
    <>
      <PageTitle title={t("Ish jadvali")} hint={t("Jadval kiritilmagan {a} {b} ish soatlari bo'yicha ishlaydi", { a: v.staffOne.toLowerCase(), b: v.place })} />
      {members.isPending && <Spinner />}
      {members.error && <ErrorNote error={members.error} />}
      {members.data && masters.length === 0 && <Card><Empty>{v.clientOne}{" "}{t("qabul qiladigan xodim yo'q")}</Empty></Card>}
      {memberId !== null && (
        <Card>
          <label className="mb-3 block max-w-xs text-sm">{v.staffOne}
            <select className={inputClass} value={memberId} onChange={(e) => setPicked(Number(e.target.value))}>
              {masters.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.phone}</option>)}
            </select>
          </label>
          <ScheduleEditor key={memberId} businessId={b} memberId={memberId} />
        </Card>
      )}
    </>
  );
}
