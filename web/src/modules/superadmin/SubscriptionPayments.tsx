// Obunani uzaytirish: necha kun, qancha pul, qaysi usulda. Har bir uzaytirish tarixda qoladi.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { BusinessAdmin, SubscriptionMethod, SubscriptionPayment } from "../../api/types";
import { formatDate, formatMoney } from "../../components/format";
import { Button, Empty, ErrorNote, inputClass } from "../../components/ui";

import { t } from "../../i18n";
export const PAYMENT_METHODS: Record<SubscriptionMethod, string> = {
  cash: t("Naqd"), card: t("Karta"), transfer: t("Bank o'tkazmasi"), free: t("Bepul"),
};

const DAY_PRESETS = [30, 90, 365];

export function RenewForm({ business: b, onDone }: { business: BusinessAdmin; onDone: (r: BusinessAdmin) => void }) {
  const [days, setDays] = useState("30");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<SubscriptionMethod>("cash");
  const [note, setNote] = useState("");
  const free = method === "free";
  const sum = Number(amount.replace(/\s/g, "")) || 0;

  const renew = useMutation({
    mutationFn: () => api<BusinessAdmin>(`/superadmin/businesses/${b.id}/subscription/renew`, json("POST", {
      days: Number(days), amount: free ? 0 : sum, method, note: note.trim() || null,
    })),
    onSuccess: (r) => {
      setAmount("");
      setNote("");
      onDone(r);
    },
  });

  const validDays = Number(days) >= 1 && Number(days) <= 3660;
  return (
    <form className="space-y-3 rounded-lg border border-line p-3"
      onSubmit={(e) => { e.preventDefault(); if (validDays) renew.mutate(); }}>
      <p className="font-medium">{t("Obunani uzaytirish")}</p>
      <div className="flex flex-wrap items-end gap-2">
        {DAY_PRESETS.map((d) => (
          <Button key={d} type="button" variant={days === String(d) ? "primary" : "secondary"} onClick={() => setDays(String(d))}>
            {d}{" "}{t("kun")}
          </Button>
        ))}
        <label className="block w-24">{t("Kun")}
          <input className={inputClass} type="number" min={1} max={3660} required value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">{t("To'lov usuli")}
          <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as SubscriptionMethod)}>
            {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block">{t("Summa, so'm")}
          <input className={inputClass} inputMode="numeric" disabled={free} placeholder={free ? "—" : t("masalan, 150000")}
            value={free ? "" : amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, ""))} />
        </label>
      </div>
      <label className="block">{t("Izoh (ixtiyoriy)")}
        <input className={inputClass} maxLength={300} placeholder={t("masalan, chek raqami")} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {renew.error && <ErrorNote error={renew.error} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!validDays || renew.isPending}>
          +{validDays ? days : "?"}{" "}{t("kun")}{!free && sum > 0 ? `, ${formatMoney(sum)}` : ""}
        </Button>
        {renew.isSuccess && <span className="text-success">{t("Uzaytirildi")}</span>}
      </div>
    </form>
  );
}

export function PaymentHistory({ businessId }: { businessId: number }) {
  const q = useQuery({
    queryKey: ["superadmin", "subscription-payments", businessId],
    queryFn: () => api<SubscriptionPayment[]>(`/superadmin/businesses/${businessId}/subscription/payments`),
  });
  if (q.error) return <ErrorNote error={q.error} />;
  const rows = q.data ?? [];
  const total = rows.reduce((n, p) => n + p.amount, 0);
  return (
    <div>
      <p className="mb-1 flex flex-wrap justify-between gap-2 font-medium">
        <span>{t("To'lovlar tarixi")}</span>
        {rows.length > 0 && <span className="font-normal text-muted">{t("Jami:")}{" "}{formatMoney(total)}</span>}
      </p>
      {q.isLoading ? null : rows.length === 0 ? <Empty>{t("Hali uzaytirilmagan")}</Empty> : (
        <ul className="divide-y divide-line">
          {rows.map((p) => (
            <li key={p.id} className="py-2">
              <div className="flex flex-wrap justify-between gap-x-3">
                <span>{formatDate(p.created_at)} · +{p.days}{" "}{t("kun")}</span>
                <span className="tabular-nums">{p.method === "free" ? t("Bepul") : `${formatMoney(p.amount)} · ${PAYMENT_METHODS[p.method]}`}</span>
              </div>
              <p className="text-xs text-muted">
                {formatDate(p.ends_at)}{" "}{t("gacha")}{p.created_by_name ? ` · ${p.created_by_name}` : ""}{p.note ? ` · ${p.note}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
