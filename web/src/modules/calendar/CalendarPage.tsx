import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../api/client";
import type { Appointment, CalendarData, Membership } from "../../api/types";
import {
  addDays,
  clock,
  dayOf,
  minutesOf,
  mondayOf,
  shortDate,
  todayIso,
  WEEKDAYS,
  weekdayOf,
} from "../../components/format";
import { Button, Empty, ErrorNote, PageTitle, Spinner } from "../../components/ui";
import { AppointmentDialog } from "./AppointmentDialog";
import { BookingDialog, type BookingPreset } from "./BookingDialog";
import { TimeGrid, type Column } from "./TimeGrid";

type View = "day" | "week";

export function CalendarPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const canBook = membership.permissions.includes("appointments.manage");
  const [view, setView] = useState<View>("day");
  const [day, setDay] = useState(todayIso());
  const [memberFilter, setMemberFilter] = useState<number | null>(null);
  const [booking, setBooking] = useState<BookingPreset | null>(null);
  const [opened, setOpened] = useState<Appointment | null>(null);

  const start = view === "day" ? day : mondayOf(day);
  const days = view === "day" ? 1 : 7;

  const query = useQuery({
    queryKey: ["calendar", b, start, days],
    queryFn: () => api<CalendarData>(`/businesses/${b}/calendar?start=${start}&days=${days}`),
    refetchInterval: 30_000,       // mijoz ilovadan bron qilsa, qabulxona ekranida o'zi chiqadi
    placeholderData: (previous) => previous,
  });
  const data = query.data;

  const masterName = (id: number) => data?.staff.find((s) => s.id === id)?.full_name ?? "Usta";

  const columns = useMemo<Column[]>(() => {
    if (!data) return [];
    if (view === "day") {
      return data.staff.map((s) => ({
        key: String(s.id),
        title: s.full_name,
        subtitle: s.title,
        items: data.appointments.filter((a) => a.member_id === s.id),
      }));
    }
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      return {
        key: d,
        title: WEEKDAYS[weekdayOf(d)],
        subtitle: shortDate(d),
        items: data.appointments.filter(
          (a) => dayOf(a.starts_at) === d && (memberFilter === null || a.member_id === memberFilter),
        ),
      };
    });
  }, [data, view, start, memberFilter]);

  // Ish vaqtidan tashqaridagi bron ham ko'rinsin
  const [hourFrom, hourTo] = useMemo(() => {
    if (!data) return [9, 20];
    const starts = data.appointments.map((a) => Math.floor(minutesOf(a.starts_at) / 60));
    const ends = data.appointments.map((a) => Math.ceil(minutesOf(a.ends_at) / 60));
    return [Math.min(data.hour_from, ...starts), Math.max(data.hour_to, ...ends)];
  }, [data]);

  const step = (direction: number) => setDay(addDays(day, direction * days));

  const openNew = (columnKey: string, minutes: number) => {
    const time = clock(minutes);
    if (view === "day") setBooking({ day, memberId: Number(columnKey), time });
    else setBooking({ day: columnKey, memberId: memberFilter ?? undefined, time });
  };

  const title =
    view === "day"
      ? `${WEEKDAYS[weekdayOf(day)]}, ${shortDate(day)}`
      : `${shortDate(start)} – ${shortDate(addDays(start, 6))}`;

  return (
    <>
      <PageTitle
        title="Kalendar"
        hint={title}
        action={
          canBook && (
            <Button className="flex items-center gap-1" onClick={() => setBooking({ day: day < todayIso() ? todayIso() : day })}>
              <Plus size={16} aria-hidden /> Yangi bron
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm" role="group" aria-label="Ko'rinish">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 ${view === v ? "bg-primary text-white" : "text-muted"}`}
            >
              {v === "day" ? "Kun" : "Hafta"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" aria-label="Oldingi" onClick={() => step(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="secondary" onClick={() => setDay(todayIso())}>
            Bugun
          </Button>
          <Button variant="secondary" aria-label="Keyingi" onClick={() => step(1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
        <input
          type="date"
          aria-label="Sana"
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm"
        />
        {view === "week" && data && (
          <select
            aria-label="Usta"
            value={memberFilter ?? ""}
            onChange={(e) => setMemberFilter(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm"
          >
            <option value="">Barcha ustalar</option>
            {data.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {query.isPending && <Spinner />}
      {query.error && <ErrorNote error={query.error} />}
      {data && data.staff.length === 0 && <Empty>Hali usta qo'shilmagan</Empty>}
      {data && data.staff.length > 0 && (
        <TimeGrid
          columns={columns}
          hourFrom={hourFrom}
          hourTo={hourTo}
          onEmptyClick={canBook ? openNew : undefined}
          onOpen={setOpened}
          label={(a) => (view === "week" ? masterName(a.member_id) : a.services.join(", "))}
        />
      )}

      {booking && <BookingDialog membership={membership} preset={booking} onClose={() => setBooking(null)} />}
      {opened && (
        <AppointmentDialog
          membership={membership}
          appointment={opened}
          masterName={masterName(opened.member_id)}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}
