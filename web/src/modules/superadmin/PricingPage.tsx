// Narxlar: Super Admin tariflar va paketlarni boshqaradi.
//  - Tarif (Start, Biznes ...) — oylik narx. O'zgartirilsa, xohlasangiz shu tarifdagi muassasalarga ham qo'llanadi.
//  - Paket (1/3/6/12 oy) — oldindan to'lashdagi chegirma va yoqilgan/o'chirilganligi.
// Muassasaning o'z narxi uning "Obuna" oynasida (tarif yoki maxsus narx).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { BillingPackageAdmin, BillingPlan } from "../../api/types";
import { formatMoney } from "../../components/format";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";

import { t } from "../../i18n";

const money = (s: string) => Number(s.replace(/\s/g, ""));
const moneyOk = (s: string) => s.trim() !== "" && Number.isInteger(money(s)) && money(s) >= 0 && money(s) <= 100_000_000;
const onlyDigits = (s: string) => s.replace(/[^\d\s]/g, "");

export function useBillingPlans() {
  return useQuery({ queryKey: ["superadmin", "billing-plans"], queryFn: () => api<BillingPlan[]>("/superadmin/billing/plans") });
}

function PlanRow({ plan }: { plan: BillingPlan }) {
  const qc = useQueryClient();
  const [name, setName] = useState(plan.name);
  const [fee, setFee] = useState(String(plan.monthly_fee));
  const [apply, setApply] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const changed = name.trim() !== plan.name || money(fee) !== plan.monthly_fee;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<BillingPlan>(`/superadmin/billing/plans/${plan.id}`, json("PATCH", body)),
    onSuccess: (r) => {
      setResult(r.updated_businesses !== null && r.updated_businesses !== undefined
        ? t("Saqlandi. {a} ta muassasa narxi yangilandi.", { a: r.updated_businesses }) : t("Saqlandi"));
      void qc.invalidateQueries({ queryKey: ["superadmin"] });     // tariflar, muassasalar narxi
    },
  });
  const feeChanged = money(fee) !== plan.monthly_fee;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block w-40 text-sm">{t("Tarif nomi")}
          <input className={inputClass} value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setResult(null); }} />
        </label>
        <label className="block w-44 text-sm">{t("Oylik narx (so'm)")}
          <input className={inputClass} inputMode="numeric" value={fee} onChange={(e) => { setFee(onlyDigits(e.target.value)); setResult(null); }} />
        </label>
        <Button disabled={!changed || !moneyOk(fee) || !name.trim() || save.isPending}
          onClick={() => save.mutate({ name: name.trim(), monthly_fee: money(fee), apply_to_businesses: feeChanged && apply })}>
          {t("Saqlash")}
        </Button>
        <Button variant="secondary" disabled={save.isPending}
          onClick={() => save.mutate({ is_active: !plan.is_active })}>
          {plan.is_active ? t("O'chirish") : t("Yoqish")}
        </Button>
        <span className="ml-auto flex items-center gap-2 text-sm text-muted">
          {!plan.is_active && <Badge tone="gray">{t("O'chirilgan")}</Badge>}
          {t("{a} ta muassasa", { a: plan.business_count })}
        </span>
      </div>
      {feeChanged && moneyOk(fee) && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
          {t("Yangi narxni shu tarifdagi {a} ta muassasaga ham qo'llash (keyingi to'lovdan boshlab)", { a: plan.business_count })}
        </label>
      )}
      {result && <p className="text-sm text-success">{result}</p>}
      {save.error && <ErrorNote error={save.error} />}
    </li>
  );
}

function NewPlanForm() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [fee, setFee] = useState("");
  const create = useMutation({
    mutationFn: () => api<BillingPlan>("/superadmin/billing/plans", json("POST", { name: name.trim(), monthly_fee: money(fee), sort_order: 100 })),
    onSuccess: () => {
      setName(""); setFee("");
      void qc.invalidateQueries({ queryKey: ["superadmin", "billing-plans"] });
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
      <label className="block w-40 text-sm">{t("Yangi tarif")}
        <input className={inputClass} value={name} maxLength={60} placeholder={t("masalan, Premium")} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block w-44 text-sm">{t("Oylik narx (so'm)")}
        <input className={inputClass} inputMode="numeric" value={fee} placeholder="599 000" onChange={(e) => setFee(onlyDigits(e.target.value))} />
      </label>
      <Button type="submit" disabled={!name.trim() || !moneyOk(fee) || create.isPending}>
        <span className="inline-flex items-center gap-1"><Plus size={16} aria-hidden /> {t("Qo'shish")}</span>
      </Button>
      {create.error && <div className="w-full"><ErrorNote error={create.error} /></div>}
    </form>
  );
}

function PackageRow({ p, sample }: { p: BillingPackageAdmin; sample: number }) {
  const qc = useQueryClient();
  const [discount, setDiscount] = useState(String(p.discount_pct));
  const d = Number(discount);
  const valid = discount.trim() !== "" && Number.isInteger(d) && d >= 0 && d <= 90;
  const save = useMutation({
    mutationFn: (body: BillingPackageAdmin) => api(`/superadmin/billing/packages/${p.months}`, json("PUT", body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["superadmin", "billing-packages"] }),
  });
  const price = valid ? Math.floor((sample * p.months * (100 - d)) / 100) : null;
  return (
    <li className="flex flex-wrap items-end gap-3 py-3 text-sm">
      <span className="w-16 font-semibold text-navy">{t("{a} oy", { a: p.months })}</span>
      <label className="block w-28">{t("Chegirma, %")}
        <input className={inputClass} inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, "").slice(0, 2))} />
      </label>
      <Button variant="secondary" disabled={!valid || d === p.discount_pct || save.isPending}
        onClick={() => save.mutate({ months: p.months, discount_pct: d, is_active: p.is_active })}>{t("Saqlash")}</Button>
      <Button variant="secondary" disabled={save.isPending || (p.months === 1 && p.is_active)}
        onClick={() => save.mutate({ months: p.months, discount_pct: p.discount_pct, is_active: !p.is_active })}>
        {p.is_active ? t("Yashirish") : t("Ko'rsatish")}
      </Button>
      {!p.is_active && <Badge tone="gray">{t("Yashirilgan")}</Badge>}
      {price !== null && sample > 0 && (
        <span className="ml-auto text-muted">{t("Masalan, {a} tarifda: {b}", { a: formatMoney(sample), b: formatMoney(price) })}</span>
      )}
      {save.error && <div className="w-full"><ErrorNote error={save.error} /></div>}
    </li>
  );
}

export function PricingPage() {
  const plans = useBillingPlans();
  const packages = useQuery({
    queryKey: ["superadmin", "billing-packages"],
    queryFn: () => api<BillingPackageAdmin[]>("/superadmin/billing/packages"),
  });
  const sample = plans.data?.find((p) => p.is_active)?.monthly_fee ?? 0;

  return (
    <div className="space-y-4">
      <PageTitle title={t("Narxlar")}
        hint={t("Tariflar va oldindan to'lash paketlari. Direktor Payme/Click orqali shu narxlarda to'laydi.")} />

      <Card>
        <h2 className="font-semibold text-navy">{t("Tariflar")}</h2>
        <p className="mb-1 text-sm text-muted">
          {t("Muassasaga tarifni uning \"Obuna\" oynasida tanlaysiz yoki maxsus (kelishilgan) narx qo'yasiz.")}
        </p>
        {plans.isLoading ? <Spinner /> : plans.error ? <ErrorNote error={plans.error} /> : (
          <>
            {plans.data!.length === 0 ? <Empty>{t("Hali tarif yo'q")}</Empty> : (
              <ul className="divide-y divide-line">{plans.data!.map((p) => <PlanRow key={`${p.id}-${p.monthly_fee}-${p.name}`} plan={p} />)}</ul>
            )}
            <NewPlanForm />
          </>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-navy">{t("Oldindan to'lash paketlari")}</h2>
        <p className="mb-1 text-sm text-muted">
          {t("Direktor necha oyga to'lashni tanlaydi. Chegirma uzoq muddatga to'lashni rag'batlantiradi.")}
        </p>
        {packages.isLoading ? <Spinner /> : packages.error ? <ErrorNote error={packages.error} /> : (
          <ul className="divide-y divide-line">
            {packages.data!.map((p) => <PackageRow key={`${p.months}-${p.discount_pct}-${p.is_active}`} p={p} sample={sample} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}
