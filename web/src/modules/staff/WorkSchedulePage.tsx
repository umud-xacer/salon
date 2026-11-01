import { useState } from "react";

import type { Membership } from "../../api/types";
import { Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";
import { useMembers } from "./MembersPanel";
import { ScheduleEditor } from "./ScheduleEditor";

export function WorkSchedulePage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const members = useMembers(b);
  const masters = members.data?.filter((m) => m.is_active && m.is_bookable) ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const memberId = picked ?? masters[0]?.id ?? null;

  return (
    <>
      <PageTitle title="Ish jadvali" hint="Jadval kiritilmagan usta salon ish soatlari bo'yicha ishlaydi" />
      {members.isPending && <Spinner />}
      {members.error && <ErrorNote error={members.error} />}
      {members.data && masters.length === 0 && <Card><Empty>Mijoz qabul qiladigan xodim yo'q</Empty></Card>}
      {memberId !== null && (
        <Card>
          <label className="mb-3 block max-w-xs text-sm">Usta
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
