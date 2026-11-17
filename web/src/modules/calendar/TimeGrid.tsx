// Vaqt to'ri. Kunlik ko'rinishda ustun = usta, haftalikda ustun = kun; komponent buni bilmaydi.
import { Fragment, type MouseEvent } from "react";

import type { Appointment, CalendarBlock } from "../../api/types";
import { clock, dayOf, formatTime, minutesOf } from "../../components/format";
import { dyn, t } from "../../i18n";
import { useVocab } from "../vocab";

const HOUR_PX = 64;
const SNAP_MIN = 30;

export interface Column {
  key: string;
  title: string;
  subtitle?: string | null;
  items: Appointment[];
  day: string;                       // ustun kuni (YYYY-MM-DD): ko'p kunlik ta'til shu kunga qirqiladi
  blocks?: CalendarBlock[];
}

// Blokning shu kundagi qismi (daqiqalarda). Kundan oldin boshlangan / keyin tugagan ta'til qirqiladi.
function blockSpan(b: CalendarBlock, day: string): [number, number] {
  const from = dayOf(b.starts_at) < day ? 0 : minutesOf(b.starts_at);
  const to = dayOf(b.ends_at) > day ? 24 * 60 : minutesOf(b.ends_at);
  return [from, to];
}

const STATUS_STYLE: Record<string, string> = {
  pending: "border-warning bg-warning/10",
  confirmed: "border-primary bg-primary/10",
  in_progress: "border-navy bg-navy/10",
  completed: "border-success bg-success/10",
  no_show: "border-danger bg-danger/10",
};
// "Mijoz keldi" — bron hali boshlanmagan, lekin mijoz zalda kutmoqda
const ARRIVED_STYLE = "border-success bg-success/20";
const isArrived = (a: Appointment) => !!a.arrived_at && (a.status === "pending" || a.status === "confirmed");

// Vaqti ustma-ust tushgan bronlar yonma-yon turadi (haftalikda ikki usta bir vaqtda bo'lishi mumkin)
function layOut(items: Appointment[]) {
  const sorted = [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const laneEnds: string[] = [];
  const placed = sorted.map((a) => {
    let lane = laneEnds.findIndex((end) => end <= a.starts_at);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = a.ends_at;
    return { a, lane };
  });
  return { placed, lanes: Math.max(laneEnds.length, 1) };
}

export function TimeGrid({ columns, hourFrom, hourTo, onEmptyClick, onOpen, onOpenBlock, label }: {
  columns: Column[];
  hourFrom: number;
  hourTo: number;
  onEmptyClick?: (columnKey: string, minutes: number) => void;
  onOpen: (a: Appointment) => void;
  onOpenBlock?: (b: CalendarBlock) => void;
  label: (a: Appointment) => string;
}) {
  const v = useVocab();
  const hours = Array.from({ length: hourTo - hourFrom }, (_, i) => hourFrom + i);
  const height = hours.length * HOUR_PX;

  const clickColumn = (key: string) => (e: MouseEvent<HTMLDivElement>) => {
    if (!onEmptyClick || e.target !== e.currentTarget) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const minutes = hourFrom * 60 + Math.floor(((y / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN;
    onEmptyClick(key, minutes);
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <div className="min-w-fit">
        <div className="sticky top-0 z-20 flex border-b border-line bg-white">
          <div className="sticky left-0 z-30 w-12 shrink-0 bg-white sm:w-14" />
          {columns.map((c) => (
            <div key={c.key} className="min-w-24 flex-1 border-l sm:min-w-28 border-line px-2 py-2 text-center">
              <p className="truncate text-sm font-medium">{c.title}</p>
              {c.subtitle && <p className="truncate text-xs text-muted">{c.subtitle}</p>}
            </div>
          ))}
        </div>

        <div className="flex">
          <div className="sticky left-0 z-10 w-12 shrink-0 bg-white sm:w-14" style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="pr-1.5 text-right text-xs text-muted tabular-nums sm:pr-2" style={{ height: HOUR_PX }}>
                {clock(h * 60)}
              </div>
            ))}
          </div>

          {columns.map((c) => {
            const { placed, lanes } = layOut(c.items);
            return (
              <div
                key={c.key}
                data-column={c.key}
                onClick={clickColumn(c.key)}
                className={`relative min-w-24 flex-1 border-l sm:min-w-28 border-line ${onEmptyClick ? "cursor-pointer" : ""}`}
                style={{
                  height,
                  backgroundImage: "linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
                  backgroundSize: `100% ${HOUR_PX}px`,
                }}
              >
                {c.blocks?.map((bl) => {
                  const [from, to] = blockSpan(bl, c.day);
                  const top = ((Math.max(from, hourFrom * 60) - hourFrom * 60) / 60) * HOUR_PX;
                  const bottom = ((Math.min(to, hourTo * 60) - hourFrom * 60) / 60) * HOUR_PX;
                  if (bottom <= top) return null;
                  return (
                    <button
                      key={`b${bl.id}`}
                      type="button"
                      onClick={() => onOpenBlock?.(bl)}
                      className="absolute inset-x-0 overflow-hidden border-y border-line px-1.5 py-0.5 text-left text-xs text-muted hover:z-10"
                      style={{
                        top,
                        height: Math.max(bottom - top - 1, 14),
                        backgroundImage: "repeating-linear-gradient(135deg, var(--color-page) 0 6px, transparent 6px 12px)",
                        backgroundColor: "color-mix(in srgb, var(--color-line) 45%, transparent)",
                      }}
                    >
                      <span className="block truncate font-medium">
                        {bl.title ? dyn(bl.title) : bl.is_block ? t("Blok") : t("Ta'til")}
                      </span>
                      {bottom - top > 30 && (
                        <span className="block truncate tabular-nums">{clock(from)}–{to >= 24 * 60 ? "24:00" : clock(to)}</span>
                      )}
                    </button>
                  );
                })}
                {placed.map(({ a, lane }) => {
                  const top = ((minutesOf(a.starts_at) - hourFrom * 60) / 60) * HOUR_PX;
                  const blockHeight = ((minutesOf(a.ends_at) - minutesOf(a.starts_at)) / 60) * HOUR_PX;
                  const lanePos = { left: `${(lane / lanes) * 100}%`, width: `${100 / lanes}%` };
                  const proc = a.processing_min ?? 0;
                  const buffer = a.buffer_min ?? 0;
                  return (
                    <Fragment key={a.id}>
                    {buffer > 0 && (
                      <div aria-hidden className="pointer-events-none absolute rounded-b-md border-l-4 border-line bg-line/40"
                           title={t("Bufer {n} daq", { n: buffer })}
                           style={{ top: top + blockHeight - 2, height: (buffer / 60) * HOUR_PX, ...lanePos }} />
                    )}
                    <button
                      onClick={() => onOpen(a)}
                      className={`absolute flex flex-col justify-start overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs hover:z-10 hover:shadow ${isArrived(a) ? ARRIVED_STYLE : STATUS_STYLE[a.status] ?? "border-line bg-page"}`}
                      style={{
                        top,
                        height: Math.max(blockHeight - 2, 20),
                        left: `${(lane / lanes) * 100}%`,
                        width: `${100 / lanes}%`,
                      }}
                    >
                      <span className="relative z-[1] block font-medium tabular-nums">
                        {isArrived(a) && <span aria-hidden className="text-success">✓ </span>}
                        {(a.client_alert || a.client_allergies) && (
                          <span className="text-amber-600" title={[a.client_allergies, a.client_alert].filter(Boolean).join(" · ")}>⚠ </span>
                        )}
                        {formatTime(a.starts_at)} {a.client_name ?? v.clientOne}
                      </span>
                      <span className="relative z-[1] block truncate text-muted">{label(a)}</span>
                      {proc > 0 && (
                        // Kutish oynasi: usta bo'sh — shu yerga boshqa bron qo'yish mumkin
                        <span aria-hidden className="pointer-events-none absolute inset-x-0 border-y border-dashed border-current/30 text-[10px] text-muted"
                              style={{
                                top: ((a.processing_offset_min ?? 0) / 60) * HOUR_PX,
                                height: (proc / 60) * HOUR_PX,
                                backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,.75) 0 5px, transparent 5px 10px)",
                              }}>
                          {(proc / 60) * HOUR_PX >= 16 && <span className="absolute right-1.5 bottom-0.5">{t("kutish")}</span>}
                        </span>
                      )}
                    </button>
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
