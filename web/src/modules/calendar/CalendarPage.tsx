import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Zap } from "lucide-react";
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
import { WalkInDialog } from "./WalkInDialog";
import { useVocab } from "../vocab";

import { dyn, pickList, t } from "../../i18n";
type View = "day" | "week";

export function CalendarPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const canBook = membership.permissions.includes("appointments.manage");
  const [view, setView] = useState<View>("day");
  const [day, setDay] = useState(todayIso());
  const [memberFilter, setMemberFilter] = useState<number | null>(null);
  const [booking, setBooking] = useState<BookingPreset | null>(null);
  const [opened, setOpened] = useState<Appointment | null>(null);
  const [walkIn, setWalkIn] = useState(false);

  const start = view === "day" ? day : mondayOf(day);
  const days = view === "day" ? 1 : 7;

  const query = useQuery({
    queryKey: ["calendar", b, start, days],
    queryFn: () => api<CalendarData>(`/businesses/${b}/calendar?start=${start}&days=${days}`),
    refetchInterval: 45_000,       // mijoz ilovadan bron qilsa, qabulxona ekranida o'zi chiqadi
    placeholderData: (previous) => previous,
  });
  const data = query.data;

  const v = useVocab();
  const masterName = (id: number) => data?.staff.find((s) => s.id === id)?.full_name ?? v.staffOne;
  // Oyna ochiq turganda xizmat qo'shilsa yoki holat o'zgarsa, yangilangan bron ko'rsatiladi
  const current = opened && (data?.appointments.find((a) => a.id === opened.id) ?? opened);

  const columns = useMemo<Column[]>(() => {
    if (!data) return [];
    if (view === "day") {
      return data.staff.map((s) => ({
        key: String(s.id),
        title: s.full_name,
        subtitle: dyn(s.title),
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
        title={v.calendar}
        hint={title}
        action={
          canBook && (
            // Tor ekranda ikkala tugma butun kenglikni teng bo'lib oladi, keng ekranda sarlavha yonida turadi
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button variant="secondary" className="flex flex-1 items-center justify-center gap-1 sm:flex-none" onClick={() => setWalkIn(true)}>
                <Zap size={16} aria-hidden /> {t("Tezkor qabul")}
              </Button>
              <Button className="flex flex-1 items-center justify-center gap-1 sm:flex-none" onClick={() => setBooking({ day: day < todayIso() ? todayIso() : day })}>
                <Plus size={16} aria-hidden /> {v.newBooking}
              </Button>
            </div>
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm" role="group" aria-label={t("Ko'rinish")}>
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 ${view === v ? "bg-primary text-white" : "text-muted"}`}
            >
              {v === "day" ? t("Kun") : t("Hafta")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" aria-label={t("Oldingi")} onClick={() => step(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="secondary" onClick={() => setDay(todayIso())}>
            {t("Bugun")}
          </Button>
          <Button variant="secondary" aria-label={t("Keyingi")} onClick={() => step(1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
        <input
          type="date"
          aria-label={t("Sana")}
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm"
        />
        {view === "week" && data && (
          <select
            aria-label={v.staffOne}
            value={memberFilter ?? ""}
            onChange={(e) => setMemberFilter(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm"
          >
            <option value="">{t("Barcha {a}", { a: v.staffMany })}</option>
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
      {data && data.staff.length === 0 && <Empty>{t("Hali {a} qo'shilmagan", { a: v.staffMany })}</Empty>}
      {data && data.staff.length > 0 && (
        <TimeGrid
          columns={columns}
          hourFrom={hourFrom}
          hourTo={hourTo}
          onEmptyClick={canBook ? openNew : undefined}
          onOpen={setOpened}
          label={(a) => (view === "week" ? masterName(a.member_id) : pickList(a.services, a.services_ru).join(", "))}
        />
      )}

      {booking && <BookingDialog membership={membership} preset={booking} onClose={() => setBooking(null)} />}
      {walkIn && (
        <WalkInDialog
          membership={membership}
          onClose={() => setWalkIn(false)}
          onBooked={(appointment) => {
            setWalkIn(false);
            setDay(todayIso());
            setOpened(appointment);          // darhol to'lov va chek uchun
          }}
        />
      )}
      {current && (
        <AppointmentDialog
          key={current.id}
          membership={membership}
          appointment={current}
          masterName={data?.staff.some((s) => s.id === current.member_id)
            ? masterName(current.member_id) : current.member_name ?? v.staffOne}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}
