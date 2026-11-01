// Vaqt to'ri. Kunlik ko'rinishda ustun = usta, haftalikda ustun = kun; komponent buni bilmaydi.
import type { MouseEvent } from "react";

import type { Appointment } from "../../api/types";
import { clock, formatTime, minutesOf } from "../../components/format";

const HOUR_PX = 64;
const SNAP_MIN = 30;

export interface Column {
  key: string;
  title: string;
  subtitle?: string | null;
  items: Appointment[];
}

const STATUS_STYLE: Record<string, string> = {
  pending: "border-warning bg-warning/10",
  confirmed: "border-primary bg-primary/10",
  in_progress: "border-navy bg-navy/10",
  completed: "border-success bg-success/10",
  no_show: "border-danger bg-danger/10",
};

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

export function TimeGrid({ columns, hourFrom, hourTo, onEmptyClick, onOpen, label }: {
  columns: Column[];
  hourFrom: number;
  hourTo: number;
  onEmptyClick?: (columnKey: string, minutes: number) => void;
  onOpen: (a: Appointment) => void;
  label: (a: Appointment) => string;
}) {
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
          <div className="w-14 shrink-0" />
          {columns.map((c) => (
            <div key={c.key} className="min-w-28 flex-1 border-l border-line px-2 py-2 text-center">
              <p className="truncate text-sm font-medium">{c.title}</p>
              {c.subtitle && <p className="truncate text-xs text-muted">{c.subtitle}</p>}
            </div>
          ))}
        </div>

        <div className="flex">
          <div className="w-14 shrink-0" style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="pr-2 text-right text-xs text-muted tabular-nums" style={{ height: HOUR_PX }}>
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
                className={`relative min-w-28 flex-1 border-l border-line ${onEmptyClick ? "cursor-pointer" : ""}`}
                style={{
                  height,
                  backgroundImage: "linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
                  backgroundSize: `100% ${HOUR_PX}px`,
                }}
              >
                {placed.map(({ a, lane }) => {
                  const top = ((minutesOf(a.starts_at) - hourFrom * 60) / 60) * HOUR_PX;
                  const blockHeight = ((minutesOf(a.ends_at) - minutesOf(a.starts_at)) / 60) * HOUR_PX;
                  return (
                    <button
                      key={a.id}
                      onClick={() => onOpen(a)}
                      className={`absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs hover:z-10 hover:shadow ${STATUS_STYLE[a.status] ?? "border-line bg-page"}`}
                      style={{
                        top,
                        height: Math.max(blockHeight - 2, 20),
                        left: `${(lane / lanes) * 100}%`,
                        width: `${100 / lanes}%`,
                      }}
                    >
                      <span className="block font-medium tabular-nums">
                        {formatTime(a.starts_at)} {a.client_name ?? "Mijoz"}
                      </span>
                      <span className="block truncate text-muted">{label(a)}</span>
                    </button>
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
