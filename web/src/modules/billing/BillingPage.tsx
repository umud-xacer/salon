// Obuna to'lovi: direktor paket tanlab, Payme yoki Click orqali to'laydi.
//  - Panelda "Obuna" bo'limi (oldindan to'lash, uzaytirish).
//  - Obuna tugaganda butun panel o'rniga shu sahifa (BillingPaywall): boshqa bo'limga o'tib bo'lmaydi.
// Narxni server hisoblaydi; bu yerda faqat ko'rsatiladi. To'lovdan keyin Payme/Click foydalanuvchini
// ?order=ID bilan qaytaradi — sahifa buyurtma holatini kuzatib, to'langach panelni yangilaydi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, json } from "../../api/client";
import type { BillingInfo, BillingOrder, BillingProvider, Membership } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { formatDate, formatMoney } from "../../components/format";
import { Badge, Button, Card, ErrorNote, PageTitle, Spinner } from "../../components/ui";

import { t } from "../../i18n";

const PROVIDERS: { id: BillingProvider; name: string; color: string }[] = [
  { id: "payme", name: "Payme", color: "#00CCCC" },
  { id: "click", name: "Click", color: "#0073FF" },
];

const monthsLabel = (n: number) => t("{a} oy", { a: n });

/** Server bilan bir xil: max(tugash, hozir) + N oy */
function extendTo(endsAt: string, months: number): string {
  const d = new Date(Math.max(new Date(endsAt).getTime(), Date.now()));
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

/** Payme / Click rasmiy rangidagi tugma (logotip fayllari serverga keyin qo'yiladi — hozircha nomi bilan) */
function ProviderMark({ id }: { id: BillingProvider }) {
  if (id === "payme") {
    return (
      <span className="text-lg font-extrabold tracking-tight">
        <span style={{ color: "#33CCCC" }}>pay</span><span style={{ color: "#1A2B5F" }}>me</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-lg font-extrabold" style={{ color: "#0073FF" }}>
      <span className="inline-block h-4 w-4 rounded-full border-[3px]" style={{ borderColor: "#0073FF" }} aria-hidden />
      click
    </span>
  );
}

function useBilling(businessId: number) {
  return useQuery({
    queryKey: ["billing", businessId],
    queryFn: () => api<BillingInfo>(`/businesses/${businessId}/billing`),
  });
}

/** To'lov tizimidan qaytgandan keyin buyurtmani kuzatish */
function ReturnWatcher({ businessId, orderId }: { businessId: number; orderId: number }) {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const q = useQuery({
    queryKey: ["billing-order", businessId, orderId],
    queryFn: () => api<BillingOrder>(`/businesses/${businessId}/billing/orders/${orderId}`),
    refetchInterval: (query) => (query.state.data?.status === "paid" ? false : 3000),
  });
  const paid = q.data?.status === "paid";
  useEffect(() => {
    if (paid) {
      void qc.invalidateQueries({ queryKey: ["billing", businessId] });
      void refresh();                                   // /auth/me: operational = true -> panel ochiladi
    }
  }, [paid, businessId, qc, refresh]);

  if (q.error) return null;
  return (
    <Card className={paid ? "border-success/40 bg-success/5" : ""}>
      <div className="flex items-center gap-3 text-sm">
        {paid ? <CheckCircle2 className="text-success" size={22} aria-hidden /> : <Loader2 className="animate-spin text-primary" size={22} aria-hidden />}
        <div>
          <p className="font-medium text-navy">
            {paid ? t("To'lov qabul qilindi — obuna uzaytirildi") : t("To'lov tekshirilmoqda...")}
          </p>
          <p className="text-muted">
            {paid ? t("Panel ochildi, ishni davom ettirishingiz mumkin.")
              : t("To'lov tizimidan tasdiq kelishi bilan sahifa o'zi yangilanadi. Odatda bir necha soniya.")}
          </p>
        </div>
      </div>
    </Card>
  );
}

function StatusCard({ info }: { info: BillingInfo }) {
  const expired = !info.operational;
  const soon = info.operational && info.days_left !== null && info.days_left < 3;
  return (
    <Card className={expired ? "border-danger/40 bg-danger/5" : soon ? "border-amber-300 bg-amber-50" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          <p className="text-muted">{t("Obuna holati")}</p>
          <p className="text-lg font-semibold text-navy">
            {info.subscription_ends_at === null ? t("Muddatsiz")
              : expired ? t("{a} kuni tugagan", { a: formatDate(info.subscription_ends_at) })
              : t("{a} gacha", { a: formatDate(info.subscription_ends_at) })}
          </p>
        </div>
        {expired ? <Badge tone="red">{t("To'xtatilgan")}</Badge>
          : soon ? <Badge tone="amber">{t("{a} kun qoldi", { a: Math.max(0, info.days_left!) })}</Badge>
          : <Badge tone="green">{t("Faol")}</Badge>}
        <div className="text-right">
          <p className="text-muted">{t("Oylik narx")}</p>
          <p className="font-semibold text-navy">{formatMoney(info.monthly_fee)}</p>
        </div>
      </div>
    </Card>
  );
}

export function BillingView({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const [params] = useSearchParams();
  const returnedOrder = Number(params.get("order")) || null;
  const q = useBilling(b);
  const [months, setMonths] = useState<number | null>(null);

  const pay = useMutation({
    mutationFn: (v: { provider: BillingProvider; months: number }) =>
      api<BillingOrder & { pay_url: string }>(`/businesses/${b}/billing/orders`, json("POST", v)),
    onSuccess: (order) => window.location.assign(order.pay_url),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const info = q.data!;
  const selected = info.packages.find((p) => p.months === (months ?? info.packages[0]?.months)) ?? null;
  const anyProvider = info.providers.payme || info.providers.click;

  return (
    <div className="space-y-4">
      {returnedOrder && <ReturnWatcher businessId={b} orderId={returnedOrder} />}
      <StatusCard info={info} />

      <Card>
        <h2 className="mb-1 font-semibold text-navy">{info.operational ? t("Keyingi oy(lar)ni oldindan to'lash") : t("Muddatni tanlang")}</h2>
        <p className="mb-3 text-sm text-muted">
          {t("Oldindan bir necha oyga to'lashingiz mumkin. Qolgan kunlaringiz kuymaydi — yangi muddat ularning ustiga qo'shiladi.")}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {info.packages.map((p) => {
            const active = selected?.months === p.months;
            return (
              <button key={p.months} type="button" onClick={() => setMonths(p.months)}
                className={`rounded-xl border p-3 text-left transition ${active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-line bg-white hover:border-primary/50"}`}>
                <p className="text-sm font-semibold text-navy">{monthsLabel(p.months)}</p>
                <p className="mt-1 text-base font-bold text-navy tabular-nums">{formatMoney(p.amount)}</p>
                {p.discount_pct > 0 ? (
                  <p className="text-xs text-success">
                    <span className="text-muted line-through">{formatMoney(p.full_amount)}</span> −{p.discount_pct}%
                  </p>
                ) : <p className="text-xs text-muted">{t("{a} / oy", { a: formatMoney(Math.round(p.amount / p.months)) })}</p>}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold text-navy">{t("To'lov usuli")}</h2>
        <p className="mb-3 text-sm text-muted">
          {selected ? t("To'lanadigan summa: {a} ({b})", { a: formatMoney(selected.amount), b: monthsLabel(selected.months) }) : ""}
          {selected && info.subscription_ends_at !== null && (
            <span className="block">{t("To'lovdan keyin obuna {a} gacha uzayadi.", { a: formatDate(extendTo(info.subscription_ends_at, selected.months)) })}</span>
          )}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROVIDERS.map((p) => {
            const enabled = info.providers[p.id];
            return (
              <button key={p.id} type="button" disabled={!enabled || !selected || pay.isPending}
                onClick={() => pay.mutate({ provider: p.id, months: selected!.months })}
                className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3 transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50">
                <ProviderMark id={p.id} />
                <span className="text-sm text-muted">
                  {!enabled ? t("Tez orada") : pay.isPending && pay.variables?.provider === p.id ? t("Ochilmoqda...") : t("{a} orqali to'lash", { a: p.name })}
                </span>
              </button>
            );
          })}
        </div>
        {!anyProvider && (
          <p className="mt-3 text-sm text-muted">
            {t("Onlayn to'lov hozircha ulanmoqda. Obunani uzaytirish uchun Chronix bilan bog'laning.")}
          </p>
        )}
        {pay.error && <div className="mt-3"><ErrorNote error={pay.error} /></div>}
        <p className="mt-3 text-xs text-muted">
          {t("To'lov Payme yoki Click sahifasida amalga oshiriladi. Karta ma'lumotlari Chronix'ga kelmaydi.")}
        </p>
      </Card>

      {info.orders.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold text-navy">{t("To'lovlar tarixi")}</h2>
          <ul className="divide-y divide-line text-sm">
            {info.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-muted">{formatDate(o.paid_at ?? o.created_at)}</span>
                <span>{monthsLabel(o.months)} · {o.provider === "payme" ? "Payme" : "Click"}</span>
                <span className="tabular-nums">{formatMoney(o.amount)}</span>
                {o.status === "paid" ? <Badge tone="green">{t("To'langan")}</Badge>
                  : o.status === "cancelled" ? <Badge tone="gray">{t("Bekor qilingan")}</Badge>
                  : <Badge tone="amber">{t("Kutilmoqda")}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Paneldagi "Obuna" bo'limi */
export function BillingPage({ membership }: { membership: Membership }) {
  return (
    <div className="space-y-4">
      <PageTitle title={t("Obuna")} hint={t("Obunani oldindan to'lash va uzaytirish")} />
      <BillingView membership={membership} />
    </div>
  );
}

/** Obuna tugaganda direktor uchun butun panel o'rniga: faqat to'lov sahifasi */
export function BillingPaywall({ membership }: { membership: Membership }) {
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen bg-page">
      <div className="bg-navy px-4 py-6 text-white">
        <div className="mx-auto flex max-w-3xl items-start gap-3">
          <Lock className="mt-1 shrink-0" size={28} aria-hidden />
          <div>
            <h1 className="text-xl font-semibold">{t("{a}: obuna muddati tugagan", { a: membership.business_name })}</h1>
            <p className="mt-1 text-sm text-white/80">
              {t("Panel vaqtincha yopildi va muassasa mobil ilovada ko'rinmayapti. Barcha ma'lumotlaringiz saqlangan — to'lovdan so'ng hammasi darhol shu joyidan davom etadi.")}
            </p>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <BillingView membership={membership} />
        <div className="text-center">
          <Button variant="secondary" onClick={() => void signOut()}>{t("Chiqish")}</Button>
        </div>
      </div>
    </div>
  );
}

/** Muddat tugashiga 3 kundan kam qolganda direktor panelidagi ogohlantirish */
export function ExpiryBanner({ membership, billingUrl }: { membership: Membership; billingUrl: string }) {
  if (membership.role !== "owner" || !membership.subscription_ends_at) return null;
  const ms = new Date(membership.subscription_ends_at).getTime() - Date.now();
  if (ms <= 0 || ms > 3 * 86_400_000) return null;
  const days = Math.floor(ms / 86_400_000);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertTriangle size={20} className="shrink-0" aria-hidden />
      <span className="flex-1">
        {days === 0
          ? t("Obuna bugun tugaydi ({a}). To'lanmasa panel yopiladi va muassasa ilovada ko'rinmay qoladi.", { a: formatDate(membership.subscription_ends_at) })
          : t("Obuna tugashiga {a} kun qoldi ({b}). To'lanmasa panel yopiladi va muassasa ilovada ko'rinmay qoladi.", { a: days, b: formatDate(membership.subscription_ends_at) })}
      </span>
      <Link to={billingUrl} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-dark">
        <CreditCard size={16} aria-hidden /> {t("To'lash")}
      </Link>
    </div>
  );
}
