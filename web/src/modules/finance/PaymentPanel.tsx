// Bitta bron to'lovi: qolgan qarz, to'lov qabul qilish, qaytarish. Kalendar va Kassa oynalarida bir xil ishlaydi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { AppointmentPayments, Membership, Payment } from "../../api/types";
import { formatMoney, formatTime, METHOD_LABELS } from "../../components/format";
import { Badge, Button, ErrorNote, inputClass, Spinner } from "../../components/ui";

export function PaymentPanel({ membership, appointmentId, onPaid }: {
  membership: Membership;
  appointmentId: number;
  onPaid?: () => void;
}) {
  const b = membership.business_id;
  const url = `/businesses/${b}/appointments/${appointmentId}/payments`;
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["payments", b, appointmentId], queryFn: () => api<AppointmentPayments>(url) });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["payments", b, appointmentId] });
    await queryClient.invalidateQueries({ queryKey: ["cash-day", b] });
  };

  if (query.isPending) return <Spinner />;
  if (query.error) return <div className="mt-3"><ErrorNote error={query.error} /></div>;
  const data = query.data;
  const canAccept = membership.permissions.includes("payments.accept");
  const canRefund = membership.permissions.includes("payments.refund");

  return (
    <section className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">To'lov</h3>
        {data.due === 0 ? <Badge tone="green">To'langan</Badge> : (
          <span className="text-sm">Qolgan: <b className="tabular-nums">{formatMoney(data.due)}</b></span>
        )}
      </div>
      {data.payments.length > 0 && (
        <ul className="mt-2 divide-y divide-line text-sm">
          {data.payments.map((p) => (
            <PaymentRow key={p.id} businessId={b} payment={p} canRefund={canRefund} onRefunded={refresh} />
          ))}
        </ul>
      )}
      {canAccept && data.payable && data.due > 0 && (
        <AcceptForm key={data.due} url={url} due={data.due}
          onDone={async () => { await refresh(); onPaid?.(); }} />
      )}
    </section>
  );
}

function AcceptForm({ url, due, onDone }: { url: string; due: number; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState(String(due));
  const [method, setMethod] = useState("cash");
  const accept = useMutation({
    mutationFn: () => api(url, json("POST", { amount: Number(amount), method })),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    accept.mutate();
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Summa
          <input className={inputClass} type="number" inputMode="numeric" required min={1} max={due} step={1}
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block text-sm">Usul
          <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(METHOD_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
      </div>
      {accept.error && <ErrorNote error={accept.error} />}
      <Button type="submit" disabled={accept.isPending}>To'lovni qabul qilish</Button>
    </form>
  );
}

export function PaymentRow({ businessId, payment: p, canRefund, showClient, onRefunded }: {
  businessId: number;
  payment: Payment;
  canRefund: boolean;
  showClient?: boolean;
  onRefunded: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const refund = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/payments/${p.id}/refund`, json("POST", { reason: reason.trim() })),
    onSuccess: onRefunded,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    refund.mutate();
  };

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted tabular-nums">{formatTime(p.paid_at)}</span>
        <span>{METHOD_LABELS[p.method] ?? p.method}</span>
        {showClient && <span className="min-w-0 flex-1 truncate">{p.client_name}</span>}
        <span className={`ml-auto tabular-nums ${p.status === "refunded" ? "text-muted line-through" : ""}`}>
          {formatMoney(p.amount)}
        </span>
        {p.status === "refunded" && <Badge tone="red">Qaytarilgan</Badge>}
        {p.status === "paid" && canRefund && !asking && (
          <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => setAsking(true)}>Qaytarish</Button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {p.received_by_name ?? "Super Admin"}
        {p.refund_reason && ` · Sabab: ${p.refund_reason}`}
      </p>
      {asking && p.status === "paid" && (
        <form onSubmit={submit} className="mt-2 space-y-2">
          <label className="block text-sm">Qaytarish sababi
            <input className={inputClass} required minLength={3} maxLength={500} autoFocus value={reason}
              onChange={(e) => setReason(e.target.value)} />
          </label>
          {refund.error && <ErrorNote error={refund.error} />}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={refund.isPending}>Qaytarishni tasdiqlash</Button>
            <Button type="button" variant="secondary" onClick={() => setAsking(false)}>Yo'q</Button>
          </div>
        </form>
      )}
    </li>
  );
}
