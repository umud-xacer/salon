// Usta paneli: faqat o'z bronlari va ish jadvali. Moliya bu yerda umuman yo'q.
import { useQuery } from "@tanstack/react-query";

import { api } from "../../api/client";
import type { Membership, ScheduleDay } from "../../api/types";
import { BookingList } from "../../components/BookingList";
import { WEEKDAYS } from "../../components/format";
import { Card, Empty, ErrorNote, PageTitle, Spinner } from "../../components/ui";

export function MyBookingsPage({ membership }: { membership: Membership }) {
  return (
    <>
      <PageTitle title="Mening bronlarim" />
      <BookingList businessId={membership.business_id} showMaster={false} />
    </>
  );
}

const hhmm = (t: string) => t.slice(0, 5);

export function MySchedulePage({ membership }: { membership: Membership }) {
  const { business_id: b, member_id: m } = membership;
  const query = useQuery({
    queryKey: ["schedule", b, m],
    queryFn: () => api<ScheduleDay[]>(`/businesses/${b}/members/${m}/schedule`),
  });

  return (
    <>
      <PageTitle title="Ish jadvalim" />
      <Card>
        {query.isPending && <Spinner />}
        {query.error && <ErrorNote error={query.error} />}
        {query.data?.length === 0 && <Empty>Ish jadvali hali kiritilmagan</Empty>}
        <ul className="divide-y divide-line">
          {query.data?.map((d) => (
            <li key={d.weekday} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
              <span className="font-medium">{WEEKDAYS[d.weekday]}</span>
              <span className="tabular-nums">
                {hhmm(d.start_time)}–{hhmm(d.end_time)}
                {d.breaks.map((br) => (
                  <span key={br.start} className="ml-3 text-muted">
                    tanaffus {hhmm(br.start)}–{hhmm(br.end)}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
