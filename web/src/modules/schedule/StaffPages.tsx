// Usta paneli: faqat o'z bronlari va ish jadvali. Moliya bu yerda umuman yo'q.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, json } from "../../api/client";
import type { Membership, ScheduleDay } from "../../api/types";
import { BookingList } from "../../components/BookingList";
import { DURATION_CHOICES, formatDuration, formatMoney, WEEKDAYS } from "../../components/format";
import { Card, Empty, ErrorNote, PageTitle, Spinner } from "../../components/ui";

import { t } from "../../i18n";
export function MyBookingsPage({ membership }: { membership: Membership }) {
  return (
    <>
      <PageTitle title={t("Mening bronlarim")} />
      <BookingList businessId={membership.business_id} showMaster={false} />
    </>
  );
}

const hhmm = (tx: string) => tx.slice(0, 5);

export function MySchedulePage({ membership }: { membership: Membership }) {
  const { business_id: b, member_id: m } = membership;
  const query = useQuery({
    queryKey: ["schedule", b, m],
    queryFn: () => api<ScheduleDay[]>(`/businesses/${b}/members/${m}/schedule`),
  });

  return (
    <>
      <PageTitle title={t("Ish jadvalim")} />
      <Card>
        {query.isPending && <Spinner />}
        {query.error && <ErrorNote error={query.error} />}
        {query.data?.length === 0 && <Empty>{t("Ish jadvali hali kiritilmagan")}</Empty>}
        <ul className="divide-y divide-line">
          {query.data?.map((d) => (
            <li key={d.weekday} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
              <span className="font-medium">{WEEKDAYS[d.weekday]}</span>
              <span className="tabular-nums">
                {hhmm(d.start_time)}–{hhmm(d.end_time)}
                {d.breaks.map((br) => (
                  <span key={br.start} className="ml-3 text-muted">
                    {t("tanaffus")}{" "}{hhmm(br.start)}–{hhmm(br.end)}
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

interface MyService { service_id: number; name: string; duration_min: number; custom_duration: number | null; price: number }

// Usta / shifokor o'zi bajaradigan xizmatlar vaqtini sozlaydi. Narx va ro'yxatni direktor belgilaydi.
export function MyServicesPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const queryClient = useQueryClient();
  const url = `/businesses/${b}/my-services`;
  const query = useQuery({ queryKey: ["my-services", b], queryFn: () => api<MyService[]>(url) });
  const save = useMutation({
    mutationFn: ({ id, minutes }: { id: number; minutes: number | null }) =>
      api(`${url}/${id}`, json("PUT", { custom_duration: minutes })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-services", b] }),
  });

  return (
    <>
      <PageTitle title={t("Xizmatlarim")} hint={t("Har bir xizmatga qancha vaqt ketishini tanlang — mijozlar shunga qarab bron qiladi")} />
      <Card>
        {query.isPending && <Spinner />}
        {query.error && <ErrorNote error={query.error} />}
        {save.error && <div className="mb-2"><ErrorNote error={save.error} /></div>}
        {query.data?.length === 0 && <Empty>{t("Sizga hali xizmat biriktirilmagan. Direktorga murojaat qiling.")}</Empty>}
        <ul className="divide-y divide-line">
          {query.data?.map((s) => (
            <li key={s.service_id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
              <span className="min-w-0 flex-1 break-words font-medium">{s.name}</span>
              <select aria-label={`${s.name}: davomiylik`} disabled={save.isPending}
                className="rounded-lg border border-line bg-white px-2 py-1.5"
                value={s.custom_duration ?? ""}
                onChange={(e) => save.mutate({ id: s.service_id, minutes: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{formatDuration(s.duration_min)}{" "}{t("(umumiy)")}</option>
                {DURATION_CHOICES.filter((m) => m !== s.duration_min).map((m) => (
                  <option key={m} value={m}>{formatDuration(m)}</option>
                ))}
              </select>
              <span className="w-28 text-right text-muted tabular-nums">{formatMoney(s.price)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
