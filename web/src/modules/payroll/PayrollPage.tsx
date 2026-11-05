import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { Compensation, Membership, Payroll, PayrollList } from "../../api/types";
import { formatDate, formatMoney, formatQty, todayIso } from "../../components/format";
import { roleLabel, useVocab } from "../vocab";
import { Modal } from "../../components/Modal";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner, Tabs } from "../../components/ui";

const STATUS: Record<string, { label: string; tone: "gray" | "amber" | "green" }> = {
  draft: { label: "Qoralama", tone: "gray" },
  approved: { label: "Tasdiqlangan", tone: "amber" },
  paid: { label: "To'langan", tone: "green" },
};

const StatusBadge = ({ status }: { status: string }) => (
  <Badge tone={STATUS[status]?.tone ?? "gray"}>{STATUS[status]?.label ?? status}</Badge>
);

export function PayrollPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const [tab, setTab] = useState<"payroll" | "rates">("payroll");
  return (
    <>
      <PageTitle title="Oylik" hint="Foiz haqiqatda tushgan puldan hisoblanadi" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ id: "payroll", label: "Oyliklar" }, { id: "rates", label: "Stavkalar" }]}
      />
      {tab === "payroll" ? <Payrolls businessId={b} /> : <Rates businessId={b} />}
    </>
  );
}

function Payrolls({ businessId }: { businessId: number }) {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [open, setOpen] = useState<number | null>(null);
  const key = ["payroll", businessId, month];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<PayrollList>(`/businesses/${businessId}/payroll?month=${month}`),
  });
  const generate = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/payroll/generate`, json("POST", { month })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const items = query.data?.items;
  const current = items?.find((p) => p.id === open) ?? null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="month" aria-label="Oy" className="rounded-lg border border-line bg-white px-2 py-2 text-sm"
          value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <Button disabled={generate.isPending} onClick={() => generate.mutate()}>
          {items?.length ? "Qayta hisoblash" : "Hisoblash"}
        </Button>
      </div>
      {generate.error && <div className="mb-3"><ErrorNote error={generate.error} /></div>}
      {query.isPending && <Spinner />}
      {query.error && <ErrorNote error={query.error} />}
      {query.data && (
        <>
          <p className="mb-3 text-sm text-muted">
            Jami: <b className="text-ink tabular-nums">{formatMoney(query.data.total)}</b>
            {" · "}To'langan: <span className="tabular-nums">{formatMoney(query.data.paid)}</span>
          </p>
          {items?.length === 0 ? (
            <Card><Empty>Bu oy hisoblanmagan. Avval Stavkalarni kiriting, keyin Hisoblash ni bosing</Empty></Card>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-white">
              {items?.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setOpen(p.id)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page">
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block font-medium break-words">{p.full_name}</span>
                      <span className="block text-xs text-muted tabular-nums">
                        Stavka {formatMoney(p.base_salary)} · Foiz {formatMoney(p.commission)}
                      </span>
                    </span>
                    <StatusBadge status={p.status} />
                    <span className="font-medium tabular-nums">{formatMoney(p.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {current && <PayrollDialog businessId={businessId} payroll={current} month={month} onClose={() => setOpen(null)} />}
    </>
  );
}

function PayrollDialog({ businessId, payroll: p, month, onClose }: {
  businessId: number;
  payroll: Payroll;
  month: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const url = `/businesses/${businessId}/payroll/${p.id}`;
  const [bonus, setBonus] = useState(String(p.bonus));
  const [deductions, setDeductions] = useState(String(p.deductions));
  const [note, setNote] = useState(p.note ?? "");
  const [confirmPay, setConfirmPay] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["payroll", businessId, month] });
    await queryClient.invalidateQueries({ queryKey: ["expenses", businessId] });
    await queryClient.invalidateQueries({ queryKey: ["cash-day", businessId] });
  };
  const save = useMutation({
    mutationFn: () => api(url, json("PUT", { bonus: Number(bonus), deductions: Number(deductions),
                                             note: note.trim() || null })),
    onSuccess: refresh,
  });
  const action = useMutation({
    mutationFn: (kind: "approve" | "pay") => api(`${url}/${kind}`, json("POST", {})),
    onSuccess: refresh,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const dirty = Number(bonus) !== p.bonus || Number(deductions) !== p.deductions || (note.trim() || null) !== p.note;

  return (
    <Modal title={p.full_name} onClose={onClose}>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt className="text-muted">Stavka</dt>
        <dd className="text-right tabular-nums">{formatMoney(p.base_salary)}</dd>
        <dt className="text-muted">Tushum ({formatQty(p.commission_percent)}% foiz)</dt>
        <dd className="text-right tabular-nums">{formatMoney(p.revenue)}</dd>
        <dt className="text-muted">Foiz</dt>
        <dd className="text-right tabular-nums">{formatMoney(p.commission)}</dd>
        <dt className="font-medium">Jami</dt>
        <dd className="text-right font-medium tabular-nums">{formatMoney(p.total)}</dd>
      </dl>
      {p.status === "draft" ? (
        <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">Bonus
              <input className={inputClass} type="number" inputMode="numeric" required min={0} step={1} value={bonus}
                onChange={(e) => setBonus(e.target.value)} />
            </label>
            <label className="block text-sm">Ushlanma (avans, jarima)
              <input className={inputClass} type="number" inputMode="numeric" required min={0} step={1} value={deductions}
                onChange={(e) => setDeductions(e.target.value)} />
            </label>
          </div>
          <label className="block text-sm">Izoh
            <input className={inputClass} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button type="submit" variant="secondary" disabled={save.isPending || !dirty}>Saqlash</Button>
        </form>
      ) : (
        <div className="mt-4 border-t border-line pt-4 text-sm">
          <p>Bonus: {formatMoney(p.bonus)} · Ushlanma: {formatMoney(p.deductions)}</p>
          {p.note && <p className="mt-1 text-muted break-words">{p.note}</p>}
          {p.paid_at && <p className="mt-1 text-muted">To'langan: {formatDate(p.paid_at)}</p>}
        </div>
      )}
      {(save.error || action.error) && <div className="mt-3"><ErrorNote error={save.error ?? action.error} /></div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={p.status} />
        {p.status === "draft" && (
          <Button type="button" disabled={action.isPending || dirty} onClick={() => action.mutate("approve")}>
            Tasdiqlash
          </Button>
        )}
        {p.status === "approved" && (confirmPay ? (
          <Button type="button" disabled={action.isPending} onClick={() => action.mutate("pay")}>
            Ha, {formatMoney(p.total)} to'landi
          </Button>
        ) : (
          <Button type="button" onClick={() => setConfirmPay(true)}>To'landi deb belgilash</Button>
        ))}
      </div>
      {p.status === "draft" && dirty && <p className="mt-2 text-xs text-muted">Tasdiqlashdan oldin saqlang.</p>}
      {p.status === "draft" && !dirty && <p className="mt-2 text-xs text-muted">Tasdiqlangach, oylik o'zgartirilmaydi.</p>}
      {p.status === "approved" && <p className="mt-2 text-xs text-muted">To'langan oylik Xarajatlarga tushadi.</p>}
    </Modal>
  );
}

function Rates({ businessId }: { businessId: number }) {
  const v = useVocab();
  const [editing, setEditing] = useState<Compensation | null>(null);
  const query = useQuery({
    queryKey: ["compensation", businessId],
    queryFn: () => api<Compensation[]>(`/businesses/${businessId}/payroll/compensation`),
  });

  if (query.isPending) return <Spinner />;
  if (query.error) return <ErrorNote error={query.error} />;
  return (
    <>
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {query.data.map((c) => (
          <li key={c.member_id}>
            <button onClick={() => setEditing(c)}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page">
              <span className="min-w-0 flex-1 basis-40">
                <span className="block font-medium break-words">{c.full_name}</span>
                <span className="block text-xs text-muted">{roleLabel(c.role, v)}{c.title ? ` · ${c.title}` : ""}</span>
              </span>
              <span className="tabular-nums">{formatMoney(c.base_salary)}</span>
              <span className="text-muted tabular-nums">{formatQty(c.commission_percent)}%</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Yangi stavka keyingi hisoblashda qo'llanadi, tasdiqlangan oylik o'zgarmaydi.</p>
      {editing && <RateDialog businessId={businessId} rate={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RateDialog({ businessId, rate, onClose }: { businessId: number; rate: Compensation; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [base, setBase] = useState(String(rate.base_salary));
  const [percent, setPercent] = useState(String(rate.commission_percent));
  const save = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/payroll/compensation/${rate.member_id}`,
      json("PUT", { base_salary: Number(base), commission_percent: Number(percent) })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["compensation", businessId] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal title={rate.full_name} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Oylik stavka (so'm)
            <input className={inputClass} type="number" inputMode="numeric" required data-autofocus min={0} step={1}
              value={base} onChange={(e) => setBase(e.target.value)} />
          </label>
          <label className="block text-sm">Foiz (%)
            <input className={inputClass} type="number" inputMode="decimal" required min={0} max={100} step={0.01}
              value={percent} onChange={(e) => setPercent(e.target.value)} />
          </label>
        </div>
        {save.error && <ErrorNote error={save.error} />}
        <Button type="submit" disabled={save.isPending}>Saqlash</Button>
      </form>
    </Modal>
  );
}

export function MyPayrollPage({ membership }: { membership: Membership }) {
  const query = useQuery({
    queryKey: ["my-payroll", membership.business_id],
    queryFn: () => api<Payroll[]>(`/businesses/${membership.business_id}/my-payroll`),
  });
  return (
    <>
      <PageTitle title="Oyliklarim" hint="Tasdiqlangan oyliklar" />
      {query.isPending && <Spinner />}
      {query.error && <ErrorNote error={query.error} />}
      {query.data?.length === 0 && <Card><Empty>Hali tasdiqlangan oylik yo'q</Empty></Card>}
      {query.data && query.data.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {query.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 basis-40">
                <span className="block font-medium tabular-nums">{p.period_start.slice(5, 7)}.{p.period_start.slice(0, 4)}</span>
                <span className="block text-xs text-muted tabular-nums">
                  Stavka {formatMoney(p.base_salary)} · Foiz {formatMoney(p.commission)} · Bonus {formatMoney(p.bonus)} · Ushlanma {formatMoney(p.deductions)}
                </span>
              </span>
              <StatusBadge status={p.status} />
              <span className="font-medium tabular-nums">{formatMoney(p.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
