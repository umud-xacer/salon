// Narxlar: Super Admin tariflar va paketlarni boshqaradi.
//  - Tarif (Start, Biznes ...) — oylik narx. O'zgartirilsa, xohlasangiz shu tarifdagi muassasalarga ham qo'llanadi.
//  - Paket (1/3/6/12 oy) — oldindan to'lashdagi chegirma va yoqilgan/o'chirilganligi.
// Muassasaning o'z narxi uning "Obuna" oynasida (tarif yoki maxsus narx).
//  - Tarmoq (sql/043): filial chegirmasi tarifda, qo'shimcha bo'limlar narxi va faollashtirish muhlati shu yerda.
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
  const [branchPct, setBranchPct] = useState(String(plan.branch_discount_pct ?? 30));
  const [apply, setApply] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const pct = Number(branchPct);
  const pctOk = branchPct.trim() !== "" && Number.isInteger(pct) && pct >= 0 && pct <= 90;
  const changed = name.trim() !== plan.name || money(fee) !== plan.monthly_fee || pct !== (plan.branch_discount_pct ?? 30);

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
        <label className="block w-36 text-sm" title={t("2-chi va keyingi filiallar uchun chegirma")}>{t("Filial chegirmasi, %")}
          <input className={inputClass} inputMode="numeric" value={branchPct}
            onChange={(e) => { setBranchPct(e.target.value.replace(/\D/g, "").slice(0, 2)); setResult(null); }} />
        </label>
        <Button disabled={!changed || !moneyOk(fee) || !pctOk || !name.trim() || save.isPending}
          onClick={() => save.mutate({ name: name.trim(), monthly_fee: money(fee), branch_discount_pct: pct,
            apply_to_businesses: feeChanged && apply })}>
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
      {pctOk && moneyOk(fee) && (
        <p className="text-xs text-muted">
          {t("Tarmoqda: asosiy filial {a}, har bir qo'shimcha filial {b}", {
            a: formatMoney(money(fee)), b: formatMoney(Math.floor((money(fee) * (100 - pct)) / 100)) })}
        </p>
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

type ModulePrice = { module_code: string; name: string; monthly_fee: number; is_addon: boolean };

function ModulePriceRow({ m }: { m: ModulePrice }) {
  const qc = useQueryClient();
  const [fee, setFee] = useState(String(m.monthly_fee));
  const save = useMutation({
    mutationFn: (body: { monthly_fee: number; is_addon: boolean }) =>
      api(`/superadmin/billing/module-prices/${m.module_code}`, json("PUT", body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["superadmin", "module-prices"] }),
  });
  return (
    <li className="flex flex-wrap items-end gap-3 py-3 text-sm">
      <span className="w-48 font-medium text-navy">{m.name}</span>
      <label className="block w-40">{t("Oylik narx (so'm)")}
        <input className={inputClass} inputMode="numeric" value={fee} onChange={(e) => setFee(onlyDigits(e.target.value))} />
      </label>
      <Button variant="secondary" disabled={!moneyOk(fee) || money(fee) === m.monthly_fee || save.isPending}
        onClick={() => save.mutate({ monthly_fee: money(fee), is_addon: m.is_addon })}>{t("Saqlash")}</Button>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={m.is_addon} disabled={save.isPending}
          onChange={(e) => save.mutate({ monthly_fee: m.monthly_fee, is_addon: e.target.checked })} />
        {t("Direktor o'zi yoqa oladi")}
      </label>
      <span className="ml-auto text-muted">
        {m.monthly_fee === 0 ? t("Bepul (tarifga kiradi)") : t("{a} / oy, tarmoqqa bir marta", { a: formatMoney(m.monthly_fee) })}
      </span>
      {save.error && <div className="w-full"><ErrorNote error={save.error} /></div>}
    </li>
  );
}

function GraceSetting() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["superadmin", "billing-settings"],
    queryFn: () => api<{ activation_grace_days: number; branch_grace_days: number }>("/superadmin/billing/settings") });
  const [days, setDays] = useState<string | null>(null);
  const [branchDays, setBranchDays] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (b: { activation_grace_days: number; branch_grace_days: number }) => api("/superadmin/billing/settings", json("PUT", b)),
    onSuccess: () => { setDays(null); setBranchDays(null); void qc.invalidateQueries({ queryKey: ["superadmin", "billing-settings"] }); },
  });
  if (!q.data) return q.error ? <ErrorNote error={q.error} /> : <Spinner />;
  const value = days ?? String(q.data.activation_grace_days);
  const bValue = branchDays ?? String(q.data.branch_grace_days);
  const d = Number(value);
  const bd = Number(bValue);
  const valid = (s: string, n: number) => s.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 30;
  const ok = valid(value, d) && valid(bValue, bd);
  const changed = d !== q.data.activation_grace_days || bd !== q.data.branch_grace_days;
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="block w-44">{t("Yangi kompaniya: to'lov muhlati, kun")}
        <input className={inputClass} inputMode="numeric" value={value} onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 2))} />
      </label>
      <label className="block w-44">{t("Yangi filial: bepul kunlar")}
        <input className={inputClass} inputMode="numeric" value={bValue} onChange={(e) => setBranchDays(e.target.value.replace(/\D/g, "").slice(0, 2))} />
      </label>
      <Button variant="secondary" disabled={!ok || !changed || save.isPending}
        onClick={() => save.mutate({ activation_grace_days: d, branch_grace_days: bd })}>
        {t("Saqlash")}
      </Button>
      <p className="basis-full text-muted">
        {t("Yangi kompaniya qo'shilganda direktor 1-sanagacha bo'lgan kunlar uchun to'laydi. Shu muhlatda to'lanmasa, u yopiladi.")}
      </p>
      <p className="basis-full text-muted">
        {t("Yangi filial (direktor yoki siz qo'shgan) shuncha kun bepul ishlaydi, keyin tarmoq muddatigacha kunbay hisoblanadi. Imtiyoz tugaguncha to'lanmasa filial yopiladi.")}
      </p>
      {save.error && <div className="w-full"><ErrorNote error={save.error} /></div>}
    </div>
  );
}

export function PricingPage() {
  const plans = useBillingPlans();
  const packages = useQuery({
    queryKey: ["superadmin", "billing-packages"],
    queryFn: () => api<BillingPackageAdmin[]>("/superadmin/billing/packages"),
  });
  const sample = plans.data?.find((p) => p.is_active)?.monthly_fee ?? 0;
  const modules = useQuery({
    queryKey: ["superadmin", "module-prices"],
    queryFn: () => api<ModulePrice[]>("/superadmin/billing/module-prices"),
  });

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

      <Card>
        <h2 className="font-semibold text-navy">{t("Qo'shimcha bo'limlar (modullar) narxi")}</h2>
        <p className="mb-1 text-sm text-muted">
          {t("Narx qo'yilgan bo'limni direktor \"Obuna\" sahifasida o'zi yoqadi va oylik to'lovga qo'shiladi. Siz muassasaga bepul yoqib bergan bo'limlar sovg'a bo'lib qoladi.")}
        </p>
        {modules.isLoading ? <Spinner /> : modules.error ? <ErrorNote error={modules.error} /> : (
          <ul className="divide-y divide-line">
            {modules.data!.map((m) => <ModulePriceRow key={`${m.module_code}-${m.monthly_fee}-${m.is_addon}`} m={m} />)}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-navy">{t("Faollashtirish")}</h2>
        <GraceSetting />
      </Card>
    </div>
  );
}
