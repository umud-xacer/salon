// Haftalik ish jadvali va ta'tillar. Xodimlar oynasida ham, "Ish jadvali" sahifasida ham ishlatiladi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { ScheduleDay, TimeOff } from "../../api/types";
import { formatDate, formatTime, WEEKDAYS } from "../../components/format";
import { Button, Empty, ErrorNote, inputClass, Spinner } from "../../components/ui";

interface DayRow {
  on: boolean;
  start: string;
  end: string;
  breaks: { start: string; end: string }[];
}

const hhmm = (t: string) => t.slice(0, 5);
const time = "rounded-lg border border-line px-2 py-1 text-sm tabular-nums";
const blankDay = (): DayRow => ({ on: false, start: "09:00", end: "18:00", breaks: [] });

function toRows(days: ScheduleDay[]): DayRow[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = days.find((x) => x.weekday === i + 1);
    if (!d) return blankDay();
    return {
      on: true,
      start: hhmm(d.start_time),
      end: hhmm(d.end_time),
      breaks: d.breaks.map((b) => ({ start: hhmm(b.start), end: hhmm(b.end) })),
    };
  });
}

export function ScheduleEditor({ businessId, memberId }: { businessId: number; memberId: number }) {
  const url = `/businesses/${businessId}/members/${memberId}/schedule`;
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["schedule", businessId, memberId], queryFn: () => api<ScheduleDay[]>(url) });
  const [rows, setRows] = useState<DayRow[] | null>(null);

  useEffect(() => {
    if (query.data) setRows(toRows(query.data));
  }, [query.data]);

  const save = useMutation({
    mutationFn: (days: DayRow[]) =>
      api<ScheduleDay[]>(
        url,
        json("PUT", {
          days: days.flatMap((d, i) =>
            d.on ? [{ weekday: i + 1, start_time: d.start, end_time: d.end, breaks: d.breaks }] : [],
          ),
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(["schedule", businessId, memberId], data),
  });

  if (query.error) return <ErrorNote error={query.error} />;
  if (!rows) return <Spinner />;

  const patch = (i: number, change: Partial<DayRow>) =>
    setRows(rows.map((r, n) => (n === i ? { ...r, ...change } : r)));

  return (
    <>
      <ul className="divide-y divide-line">
        {rows.map((r, i) => (
          <li key={i} className="py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex w-32 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={r.on}
                  onChange={(e) => patch(i, { on: e.target.checked })}
                />
                {WEEKDAYS[i + 1]}
              </label>
              {r.on ? (
                <>
                  <input aria-label="Boshlanishi" type="time" className={time} value={r.start}
                    onChange={(e) => patch(i, { start: e.target.value })} />
                  <span>–</span>
                  <input aria-label="Tugashi" type="time" className={time} value={r.end}
                    onChange={(e) => patch(i, { end: e.target.value })} />
                  <button type="button" className="ml-1 text-xs text-primary"
                    onClick={() => patch(i, { breaks: [...r.breaks, { start: "13:00", end: "14:00" }] })}>
                    + tanaffus
                  </button>
                </>
              ) : (
                <span className="text-muted">Dam olish</span>
              )}
            </div>
            {r.on &&
              r.breaks.map((b, k) => (
                <div key={k} className="mt-1 flex flex-wrap items-center gap-2 pl-6">
                  <span className="text-xs text-muted">tanaffus</span>
                  <input aria-label="Tanaffus boshi" type="time" className={time} value={b.start}
                    onChange={(e) => patch(i, { breaks: r.breaks.map((x, n) => (n === k ? { ...x, start: e.target.value } : x)) })} />
                  <span>–</span>
                  <input aria-label="Tanaffus oxiri" type="time" className={time} value={b.end}
                    onChange={(e) => patch(i, { breaks: r.breaks.map((x, n) => (n === k ? { ...x, end: e.target.value } : x)) })} />
                  <button type="button" aria-label="Tanaffusni olib tashlash" className="text-muted hover:text-danger"
                    onClick={() => patch(i, { breaks: r.breaks.filter((_, n) => n !== k) })}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
          </li>
        ))}
      </ul>
      {save.error && <div className="mt-3"><ErrorNote error={save.error} /></div>}
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={save.isPending} onClick={() => save.mutate(rows)}>Jadvalni saqlash</Button>
        {save.isSuccess && <span className="text-sm text-success">Saqlandi</span>}
      </div>
      <TimeOffList businessId={businessId} memberId={memberId} />
    </>
  );
}

function TimeOffList({ businessId, memberId }: { businessId: number; memberId: number }) {
  const url = `/businesses/${businessId}/members/${memberId}/time-off`;
  const key = ["time-off", businessId, memberId];
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: () => api<TimeOff[]>(url) });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () =>
      api(url, json("POST", {
        starts_at: `${from}:00+05:00`,      // salon vaqti (Toshkent)
        ends_at: `${to}:00+05:00`,
        reason: reason.trim() || null,
      })),
    onSuccess: () => {
      setFrom("");
      setTo("");
      setReason("");
      return refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`${url}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <section className="mt-6 border-t border-line pt-4">
      <h3 className="mb-2 text-sm font-medium">Ta'til va dam olish kunlari</h3>
      {query.data?.length === 0 && <Empty>Rejalashtirilgan ta'til yo'q</Empty>}
      <ul className="mb-3 space-y-1 text-sm">
        {query.data?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-page px-3 py-1.5">
            <span className="tabular-nums">
              {formatDate(t.starts_at)} {formatTime(t.starts_at)} – {formatDate(t.ends_at)} {formatTime(t.ends_at)}
              {t.reason ? ` · ${t.reason}` : ""}
            </span>
            <button aria-label="O'chirish" className="text-muted hover:text-danger" onClick={() => remove.mutate(t.id)}>
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <label className="text-sm">Boshlanishi
          <input className={inputClass} type="datetime-local" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">Tugashi
          <input className={inputClass} type="datetime-local" required value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-sm">Sabab
          <input className={inputClass} maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <Button type="submit" variant="secondary" disabled={add.isPending} aria-label="Ta'til qo'shish" className="h-10">
          <Plus size={16} />
        </Button>
      </form>
      {(add.error || remove.error) && <div className="mt-2"><ErrorNote error={add.error ?? remove.error} /></div>}
    </section>
  );
}
