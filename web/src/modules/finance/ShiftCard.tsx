// Kassa smenasi (057_cash_shifts.sql): kun boshida ochish (boshlang'ich naqd), naqd kirim/chiqim,
// kun oxirida yopish — sanalgan naqd bilan kutilgan naqd farqi. Hisob-kitob bazada.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Lock, LockOpen } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import { formatDate, formatMoney, formatTime, METHOD_LABELS } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Button, Card, Empty, ErrorNote, inputClass, Spinner } from "../../components/ui";

import { t } from "../../i18n";

type Shift = {
  id: number; is_open: boolean; opened_at: string; opened_by_name: string | null; opening_cash: number;
  closed_at: string | null; closed_by_name: string | null; counted_cash: number | null; expected_cash: number;
  difference: number | null; income: number; methods: { method: string; income: number; refunds: number }[];
  cash_in: number; cash_out: number; note: string | null;
  movements: { id: number; kind: "in" | "out"; amount: number; note: string; created_by_name: string | null; created_at: string }[];
};

const digits = (v: string) => Number(v.replace(/\D/g, "") || 0);
const money = (v: string) => (v ? Number(v.replace(/\D/g, "")).toLocaleString("ru-RU").replace(/,/g, " ") : "");

function Diff({ value }: { value: number }) {
  const cls = value === 0 ? "text-emerald-700" : value < 0 ? "text-danger" : "text-amber-700";
  const label = value === 0 ? t("Mos keldi") : value < 0 ? t("Kam") : t("Ortiqcha");
  return <span className={`font-medium ${cls}`}>{label}{value !== 0 && `: ${formatMoney(Math.abs(value))}`}</span>;
}

export function ShiftCard({ businessId, canManage }: { businessId: number; canManage: boolean }) {
  const queryClient = useQueryClient();
  const base = `/businesses/${businessId}/cash`;
  const current = useQuery({ queryKey: ["shift", businessId], queryFn: () => api<Shift | null>(`${base}/shift/current`) });
  const history = useQuery({ queryKey: ["shifts", businessId], queryFn: () => api<Shift[]>(`${base}/shifts?limit=10`) });
  const [opening, setOpening] = useState("");
  const [move, setMove] = useState<"in" | "out" | null>(null);
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState<Shift | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["shift", businessId] });
    await queryClient.invalidateQueries({ queryKey: ["shifts", businessId] });
  };
  const open = useMutation({
    mutationFn: () => api<Shift>(`${base}/shift/open`, json("POST", { opening_cash: digits(opening) })),
    onSuccess: async () => { setOpening(""); await refresh(); },
  });

  const s = current.data;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {s ? <LockOpen size={16} className="text-emerald-600" aria-hidden /> : <Lock size={16} className="text-muted" aria-hidden />}
          {t("Kassa smenasi")}
        </h2>
        {s && <span className="text-xs text-muted">{t("{a} da ochilgan · {b}", { a: `${formatDate(s.opened_at)} ${formatTime(s.opened_at)}`, b: s.opened_by_name ?? "—" })}</span>}
      </div>
      {current.isPending && <Spinner />}
      {current.error && <ErrorNote error={current.error} />}

      {current.isSuccess && !s && (
        canManage ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); open.mutate(); }}>
            <label className="block flex-1 text-sm">{t("Kassadagi boshlang'ich naqd pul")}
              <input className={inputClass} inputMode="numeric" placeholder="0" value={money(opening)}
                onChange={(e) => setOpening(e.target.value)} />
            </label>
            <Button type="submit" disabled={open.isPending}>{t("Smenani ochish")}</Button>
            {open.error && <div className="w-full"><ErrorNote error={open.error} /></div>}
          </form>
        ) : <Empty>{t("Smena ochilmagan")}</Empty>
      )}

      {s && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("Boshlang'ich naqd")} value={s.opening_cash} />
            <Stat label={t("Smena tushumi")} value={s.income} />
            <Stat label={t("Kirim / chiqim")} value={s.cash_in - s.cash_out} signed />
            <Stat label={t("Kassada bo'lishi kerak")} value={s.expected_cash} strong />
          </div>
          {s.methods.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {s.methods.map((m) => (
                <li key={m.method}>
                  <span className="text-muted">{METHOD_LABELS[m.method] ?? m.method}:</span>{" "}
                  <span className="tabular-nums">{formatMoney(m.income - m.refunds)}</span>
                </li>
              ))}
            </ul>
          )}
          {s.movements.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {s.movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    {m.kind === "in" ? <ArrowDownLeft size={14} className="text-emerald-600" aria-hidden />
                      : <ArrowUpRight size={14} className="text-danger" aria-hidden />}
                    <span className="truncate">{m.note}</span>
                    <span className="text-xs text-muted">{formatTime(m.created_at)}</span>
                  </span>
                  <span className="tabular-nums">{m.kind === "in" ? "+" : "−"}{formatMoney(m.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setMove("in")}>{t("Naqd kirim")}</Button>
              <Button variant="secondary" onClick={() => setMove("out")}>{t("Naqd chiqim")}</Button>
              <Button className="ml-auto" onClick={() => setClosing(true)}>{t("Smenani yopish")}</Button>
            </div>
          )}
        </div>
      )}

      {history.data && history.data.filter((x) => !x.is_open).length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-xs font-medium uppercase text-muted">{t("Oxirgi smenalar")}</h3>
          <ul className="divide-y divide-line text-sm">
            {history.data.filter((x) => !x.is_open).map((x) => (
              <li key={x.id}>
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-x-3 py-2 text-left hover:bg-page"
                  onClick={() => api<Shift>(`${base}/shifts/${x.id}`).then(setReport)}>
                  <span>{formatDate(x.opened_at)} {formatTime(x.opened_at)}–{x.closed_at && formatTime(x.closed_at)}
                    <span className="text-xs text-muted"> · {x.closed_by_name ?? ""}</span></span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{formatMoney(x.income)}</span>
                    {x.difference !== null && <Diff value={x.difference} />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {move && s && <MoveDialog base={base} kind={move} onClose={() => setMove(null)} onDone={refresh} />}
      {closing && s && (
        <CloseDialog base={base} shift={s} onClose={() => setClosing(false)}
          onDone={async (r) => { setClosing(false); setReport(r); await refresh(); }} />
      )}
      {report && <ReportDialog shift={report} onClose={() => setReport(null)} />}
    </Card>
  );
}

function Stat({ label, value, strong, signed }: { label: string; value: number; strong?: boolean; signed?: boolean }) {
  return (
    <div className="rounded-lg bg-page px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={`tabular-nums ${strong ? "font-semibold text-navy" : ""}`}>
        {signed && value > 0 ? "+" : ""}{formatMoney(value)}
      </p>
    </div>
  );
}

function MoveDialog({ base, kind, onClose, onDone }: { base: string; kind: "in" | "out"; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api(`${base}/shift/move`, json("POST", { kind, amount: digits(amount), note: note.trim() })),
    onSuccess: async () => { await onDone(); onClose(); },
  });
  return (
    <Modal title={kind === "in" ? t("Naqd kirim") : t("Naqd chiqim")} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="block text-sm">{t("Summa")}
          <input className={inputClass} inputMode="numeric" required autoFocus value={money(amount)} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block text-sm">{t("Izoh")}
          <input className={inputClass} required minLength={2} maxLength={200} value={note}
            placeholder={kind === "in" ? t("Masalan: mayda pul") : t("Masalan: inkassatsiya, xo'jalik xarajati")}
            onChange={(e) => setNote(e.target.value)} />
        </label>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={save.isPending || digits(amount) <= 0 || note.trim().length < 2}>{t("Saqlash")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function CloseDialog({ base, shift, onClose, onDone }: { base: string; shift: Shift; onClose: () => void; onDone: (s: Shift) => void }) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const diff = counted ? digits(counted) - shift.expected_cash : null;
  const save = useMutation({
    mutationFn: () => api<Shift>(`${base}/shift/close`, json("POST", { counted_cash: digits(counted), note: note.trim() || null })),
    onSuccess: onDone,
  });
  return (
    <Modal title={t("Smenani yopish")} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <p className="text-sm">{t("Kassada bo'lishi kerak")}: <b className="tabular-nums">{formatMoney(shift.expected_cash)}</b></p>
        <label className="block text-sm">{t("Sanalgan naqd pul")}
          <input className={inputClass} inputMode="numeric" required autoFocus value={money(counted)} onChange={(e) => setCounted(e.target.value)} />
        </label>
        {diff !== null && <p className="text-sm"><Diff value={diff} /></p>}
        <label className="block text-sm">{t("Izoh (ixtiyoriy)")}
          <input className={inputClass} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={save.isPending || !counted}>{t("Yopish")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReportDialog({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const rows: [string, number][] = [
    [t("Boshlang'ich naqd"), shift.opening_cash],
    ...shift.methods.map((m) => [`${METHOD_LABELS[m.method] ?? m.method}`, m.income - m.refunds] as [string, number]),
    [t("Naqd kirim"), shift.cash_in],
    [t("Naqd chiqim"), -shift.cash_out],
    [t("Kassada bo'lishi kerak"), shift.expected_cash],
    [t("Sanalgan naqd pul"), shift.counted_cash ?? 0],
  ];
  return (
    <Modal title={t("Smena hisoboti")} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">
        {formatDate(shift.opened_at)} {formatTime(shift.opened_at)} — {shift.closed_at && `${formatDate(shift.closed_at)} ${formatTime(shift.closed_at)}`}
        {" · "}{shift.opened_by_name ?? "—"}{shift.closed_by_name && shift.closed_by_name !== shift.opened_by_name ? ` → ${shift.closed_by_name}` : ""}
      </p>
      <dl className="divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between py-1.5"><dt>{k}</dt><dd className="tabular-nums">{formatMoney(v)}</dd></div>
        ))}
      </dl>
      <p className="mt-3 text-sm">{t("Farq")}: {shift.difference !== null && <Diff value={shift.difference} />}</p>
      {shift.note && <p className="mt-2 text-sm text-muted">{shift.note}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => window.print()}>{t("Chop etish")}</Button>
        <Button onClick={onClose}>{t("Yopish")}</Button>
      </div>
    </Modal>
  );
}
