// Xodimlar tabeli (060_timesheet.sql): oy kunlari ustunlarda, xodimlar qatorlarda. Katakni bosib holat, smena
// soatlari va keldi/ketdini tuzatish; smenalar grafigini oraliq bo'yicha tuzish; Excel'ga yuklab olish.
// Xodim "Keldim / Ketdim" ni o'z panelidan bosadi (AttendanceCard) — vaqtni server qo'yadi.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, ChevronLeft, ChevronRight, Download, LogIn, LogOut, Settings2 } from "lucide-react";
import { useState } from "react";

import { api, downloadFile, json } from "../../api/client";
import type { Membership, MyAttendance, Timesheet, TimesheetCell, TimesheetRow, TimesheetStatus } from "../../api/types";
import { formatTime } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";

import { t } from "../../i18n";

const STYLE: Record<TimesheetStatus, string> = {
  work: "bg-emerald-50 text-emerald-800",
  late: "bg-red-100 text-red-700 font-semibold",
  absent: "bg-red-600 text-white font-semibold",
  day_off: "bg-page text-muted",
  off: "text-muted",
  vacation: "bg-sky-100 text-sky-800",
  sick: "bg-amber-100 text-amber-800",
  planned: "text-line",
  today: "bg-primary/10 text-primary",
};
const LABEL: Record<TimesheetStatus, string> = {
  work: t("Ishladi"), late: t("Kechikdi"), absent: t("Kelmadi"), day_off: t("Dam olish"), off: t("Ish kuni emas"),
  vacation: t("Ta'til"), sick: t("Kasallik"), planned: t("Reja"), today: t("Bugun"),
};
const KINDS = [
  { id: "auto", label: t("Haftalik jadval bo'yicha") }, { id: "work", label: t("Ish kuni (alohida smena)") },
  { id: "day_off", label: t("Dam olish") }, { id: "vacation", label: t("Ta'til") }, { id: "sick", label: t("Kasallik") },
  { id: "absent", label: t("Sababsiz kelmadi") },
] as const;
type Kind = (typeof KINDS)[number]["id"];

const thisMonth = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split("-").map(Number);
  const x = new Date(Date.UTC(y, mo - 1 + d, 1));
  return x.toISOString().slice(0, 7);
};
const hm = (iso: string | null) => (iso ? formatTime(iso) : "");

export function TimesheetPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const [month, setMonth] = useState(thisMonth);
  const [edit, setEdit] = useState<{ row: TimesheetRow; cell: TimesheetCell } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [settings, setSettings] = useState(false);
  const q = useQuery({
    queryKey: ["timesheet", b, month], placeholderData: keepPreviousData,
    queryFn: () => api<Timesheet>(`/businesses/${b}/timesheet?month=${month}`),
  });
  const days = q.data?.members[0]?.cells.map((c) => c.day) ?? [];
  const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

  return (
    <>
      <PageTitle title={t("Xodimlar tabeli")}
        hint={t("Katakni bosing: holat, smena soatlari, keldi-ketdi. Xodim \"Keldim/Ketdim\" ni o'z panelidan bosadi.")}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setPlanning(true)}><span className="inline-flex items-center gap-1"><CalendarRange size={16} aria-hidden />{t("Grafik tuzish")}</span></Button>
            <Button variant="secondary" onClick={() => void downloadFile(`/businesses/${b}/timesheet/export?month=${month}`, `tabel-${month}.xlsx`)}>
              <span className="inline-flex items-center gap-1"><Download size={16} aria-hidden />Excel</span>
            </Button>
            <Button variant="secondary" aria-label={t("Sozlamalar")} onClick={() => setSettings(true)}><Settings2 size={16} aria-hidden /></Button>
          </div>
        } />
      <div className="mb-3 flex items-center gap-2">
        <Button variant="secondary" aria-label={t("Oldingi oy")} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></Button>
        <input type="month" className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm" value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t("Oy")} />
        <Button variant="secondary" aria-label={t("Keyingi oy")} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></Button>
        {q.data && <span className="text-xs text-muted">{t("Kechikish chegarasi: {a} daqiqa", { a: q.data.late_grace_min })}</span>}
      </div>
      {q.isPending && <Spinner />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data?.members.length === 0 && <Card><Empty>{t("Xodim yo'q")}</Empty></Card>}
      {q.data && q.data.members.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 min-w-40 bg-white px-3 py-2 text-left font-medium">{t("Xodim")}</th>
                {days.map((d) => (
                  <th key={d} className={`w-8 px-0.5 py-2 text-center font-medium ${[0, 6].includes(weekday(d)) ? "text-danger" : "text-muted"}`}>{Number(d.slice(8))}</th>
                ))}
                <th className="px-2 py-2 text-right font-medium">{t("Kun")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("Soat")}</th>
                <th className="px-2 py-2 text-right font-medium text-danger">K</th>
                <th className="px-2 py-2 text-right font-medium text-danger">Y</th>
              </tr>
            </thead>
            <tbody>
              {q.data.members.map((r) => (
                <tr key={r.member_id} className="border-b border-line last:border-0">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                    <span className="block truncate font-medium">{r.full_name}</span>
                  </td>
                  {r.cells.map((c) => (
                    <td key={c.day} className="p-0.5">
                      <button type="button" onClick={() => setEdit({ row: r, cell: c })}
                        title={`${LABEL[c.status]}${c.check_in ? ` · ${hm(c.check_in)}–${hm(c.check_out)}` : ""}${c.late_min ? ` · ${t("kechikish {a} daq", { a: c.late_min })}` : ""}${c.note ? ` · ${c.note}` : ""}`}
                        className={`h-7 w-8 rounded text-center tabular-nums hover:ring-1 hover:ring-primary ${STYLE[c.status]}`}>
                        {c.code}
                      </button>
                    </td>
                  ))}
                  <td className="px-2 text-right tabular-nums">{r.totals.worked_days}</td>
                  <td className="px-2 text-right tabular-nums">{r.totals.worked_hours}</td>
                  <td className="px-2 text-right tabular-nums text-danger">{r.totals.late_count || ""}</td>
                  <td className="px-2 text-right tabular-nums text-danger">{r.totals.absent_days || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><b>8s</b> — {t("ishlagan soat")}</span><span><b className="text-danger">K</b> — {t("kechikdi")}</span>
        <span><b className="text-danger">Y</b> — {t("kelmadi")}</span><span><b>D</b> — {t("dam olish")}</span>
        <span><b>T</b> — {t("ta'til")}</span><span><b>B</b> — {t("kasallik")}</span>
      </p>
      {edit && <CellDialog businessId={b} month={month} row={edit.row} cell={edit.cell} onClose={() => setEdit(null)} />}
      {planning && q.data && <PlanDialog businessId={b} members={q.data.members} onClose={() => setPlanning(false)} />}
      {settings && q.data && <SettingsDialog businessId={b} grace={q.data.late_grace_min} onClose={() => setSettings(false)} />}
    </>
  );
}

function useRefresh(businessId: number) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["timesheet", businessId] }),
    queryClient.invalidateQueries({ queryKey: ["calendar", businessId] }),
  ]);
}

function CellDialog({ businessId, row, cell, onClose }: { businessId: number; month: string; row: TimesheetRow; cell: TimesheetCell; onClose: () => void }) {
  const refresh = useRefresh(businessId);
  const plannedKind: Kind = ["day_off", "vacation", "sick", "absent"].includes(cell.status) && !cell.check_in ? (cell.status as Kind) : "auto";
  const [kind, setKind] = useState<Kind>(plannedKind);
  const [start, setStart] = useState(cell.planned_start?.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(cell.planned_end?.slice(0, 5) ?? "18:00");
  const [cin, setCin] = useState(hm(cell.check_in));
  const [cout, setCout] = useState(hm(cell.check_out));
  const [note, setNote] = useState(cell.note ?? "");
  const save = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/timesheet/${row.member_id}/${cell.day}`, json("PUT", {
      kind, start_time: kind === "work" ? start : null, end_time: kind === "work" ? end : null,
      check_in: ["auto", "work"].includes(kind) && cin ? cin : null, check_out: ["auto", "work"].includes(kind) && cin && cout ? cout : null,
      note: note.trim() || null,
    })),
    onSuccess: async () => { await refresh(); onClose(); },
  });
  return (
    <Modal title={`${row.full_name} · ${cell.day.split("-").reverse().join(".")}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <p className={`inline-block rounded px-2 py-0.5 text-xs ${STYLE[cell.status]}`}>{LABEL[cell.status]}
          {cell.planned_start && ` · ${t("reja")} ${cell.planned_start.slice(0, 5)}–${cell.planned_end?.slice(0, 5)}`}
          {cell.late_min > 0 && ` · ${t("kechikish {a} daq", { a: cell.late_min })}`}
          {cell.early_min > 0 && ` · ${t("erta ketdi {a} daq", { a: cell.early_min })}`}</p>
        <label className="block text-sm">{t("Kun holati")}
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        {kind === "work" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">{t("Smena boshi")}<input type="time" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} required /></label>
            <label className="block text-sm">{t("Smena oxiri")}<input type="time" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
          </div>
        )}
        {(kind === "auto" || kind === "work") && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">{t("Keldi")}<input type="time" className={inputClass} value={cin} onChange={(e) => setCin(e.target.value)} /></label>
            <label className="block text-sm">{t("Ketdi")}<input type="time" className={inputClass} value={cout} onChange={(e) => setCout(e.target.value)} disabled={!cin} /></label>
          </div>
        )}
        {kind !== "auto" && kind !== "work" && <p className="text-xs text-muted">{t("Bu kunda onlayn bron yopiladi.")}</p>}
        <label className="block text-sm">{t("Izoh")}<input className={inputClass} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PlanDialog({ businessId, members, onClose }: { businessId: number; members: TimesheetRow[]; onClose: () => void }) {
  const refresh = useRefresh(businessId);
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const [ids, setIds] = useState<number[]>([]);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState<Kind>("day_off");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5, 6, 7]);
  const WD = [t("Du"), t("Se"), t("Ch"), t("Pa"), t("Ju"), t("Sh"), t("Ya")];
  const save = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/timesheet/plan`, json("POST", {
      member_ids: ids, date_from: from, date_to: to, kind, weekdays,
      start_time: kind === "work" ? start : null, end_time: kind === "work" ? end : null,
    })),
    onSuccess: async () => { await refresh(); onClose(); },
  });
  return (
    <Modal title={t("Smenalar grafigi")} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">{t("Xodimlar")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button key={m.member_id} type="button" onClick={() => setIds(ids.includes(m.member_id) ? ids.filter((x) => x !== m.member_id) : [...ids, m.member_id])}
                className={`rounded-full border px-2.5 py-1 text-xs ${ids.includes(m.member_id) ? "border-primary bg-primary text-white" : "border-line"}`}>{m.full_name}</button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">{t("Dan")}<input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} required /></label>
          <label className="block text-sm">{t("Gacha")}<input type="date" className={inputClass} value={to} min={from} onChange={(e) => setTo(e.target.value)} required /></label>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {WD.map((w, i) => (
            <button key={w} type="button" onClick={() => setWeekdays(weekdays.includes(i + 1) ? weekdays.filter((x) => x !== i + 1) : [...weekdays, i + 1])}
              className={`w-9 rounded border py-1 ${weekdays.includes(i + 1) ? "border-navy bg-navy text-white" : "border-line"}`}>{w}</button>
          ))}
        </div>
        <label className="block text-sm">{t("Kun holati")}
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        {kind === "work" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">{t("Smena boshi")}<input type="time" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="block text-sm">{t("Smena oxiri")}<input type="time" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
        )}
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={save.isPending || ids.length === 0 || weekdays.length === 0}>{t("Qo'llash")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function SettingsDialog({ businessId, grace, onClose }: { businessId: number; grace: number; onClose: () => void }) {
  const refresh = useRefresh(businessId);
  const [value, setValue] = useState(String(grace));
  const save = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/timesheet/settings`, json("PUT", { late_grace_min: Number(value) })),
    onSuccess: async () => { await refresh(); onClose(); },
  });
  return (
    <Modal title={t("Tabel sozlamalari")} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="block text-sm">{t("Necha daqiqadan keyin \"kechikdi\" hisoblanadi")}
          <input type="number" min={0} max={120} className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        {save.error && <ErrorNote error={save.error} />}
        <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
      </form>
    </Modal>
  );
}

/** Xodimning o'zi: "Keldim / Ketdim" (vaqtni server qo'yadi) va oy bo'yicha qisqa hisob */
export function AttendanceCard({ businessId }: { businessId: number }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["attendance-me", businessId], queryFn: () => api<MyAttendance>(`/businesses/${businessId}/attendance/me`) });
  const mark = useMutation({
    mutationFn: (action: "check-in" | "check-out") => api<MyAttendance>(`/businesses/${businessId}/attendance/${action}`, { method: "POST" }),
    onSuccess: (data) => queryClient.setQueryData(["attendance-me", businessId], data),
  });
  const today = q.data?.today;
  const totals = q.data?.month?.totals;
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{t("Bugungi ish kuni")}</h2>
          <p className="text-xs text-muted">
            {today?.planned_start ? t("Smena {a}–{b}", { a: today.planned_start.slice(0, 5), b: today.planned_end?.slice(0, 5) ?? "" }) : t("Bugun jadval bo'yicha ish kuni emas")}
            {today?.check_in && ` · ${t("keldingiz {a}", { a: hm(today.check_in) })}`}
            {today?.check_out && ` · ${t("ketdingiz {a}", { a: hm(today.check_out) })}`}
            {today?.status === "late" && <span className="text-danger"> · {t("kechikish {a} daq", { a: today.late_min })}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {!today?.check_in && (
            <Button onClick={() => mark.mutate("check-in")} disabled={mark.isPending}>
              <span className="inline-flex items-center gap-1"><LogIn size={16} aria-hidden />{t("Keldim")}</span>
            </Button>
          )}
          {today?.check_in && !today.check_out && (
            <Button variant="secondary" onClick={() => mark.mutate("check-out")} disabled={mark.isPending}>
              <span className="inline-flex items-center gap-1"><LogOut size={16} aria-hidden />{t("Ketdim")}</span>
            </Button>
          )}
        </div>
      </div>
      {mark.error && <div className="mt-2"><ErrorNote error={mark.error} /></div>}
      {totals && (
        <p className="mt-2 text-xs text-muted">
          {t("Shu oy: {a} kun, {b} soat", { a: totals.worked_days, b: totals.worked_hours })}
          {totals.late_count > 0 && <span className="text-danger"> · {t("kechikish {a} marta", { a: totals.late_count })}</span>}
          {totals.absent_days > 0 && <span className="text-danger"> · {t("kelmagan {a} kun", { a: totals.absent_days })}</span>}
        </p>
      )}
    </Card>
  );
}
