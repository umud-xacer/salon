import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { BusinessAdmin, BusinessType, ModuleInfo } from "../../api/types";
import { dayOf, formatDate, formatMoney, normalizePhone, todayIso } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, ErrorNote, inputClass, Tabs } from "../../components/ui";
import { CredentialsBox } from "../../components/CredentialsBox";
import { PasswordInput } from "../../components/PasswordReveal";
import { MembersPanel } from "../staff/MembersPanel";
import { AddressFields, type AddressValue } from "./AddressFields";
import { useBusinessTypes } from "./BusinessTypesPage";
import { slugFor, wordingFor, typeName } from "./typeWording";
import { PaymentHistory, RenewForm } from "./SubscriptionPayments";
import { useBillingPlans } from "./PricingPage";
import { OwnerChange } from "./OwnerChange";
import { PhoneOwnerHint, usePhoneLookup } from "./PhoneOwnerHint";
import { panelVocab, VocabContext } from "../vocab";

import { t } from "../../i18n";
export const BUSINESSES_KEY = ["superadmin", "businesses"];

// Super Admin o'chirilgan turlarni ham ko'radi (eski salonni tahrirlash uchun)
const useCategories = useBusinessTypes;
const typeLabel = (c: BusinessType) => (c.is_active ? typeName(c) : t("{a} (o'chirilgan)", { a: typeName(c) }));


export function StatusBadge({ b }: { b: BusinessAdmin }) {
  if (b.status === "blocked") return <Badge tone="red">{t("Bloklangan")}</Badge>;
  if (!b.operational) return <Badge tone="amber">{t("To'xtatilgan")}</Badge>;
  return <Badge tone="green">{t("Faol")}</Badge>;
}

export function CreateBusinessDialog({ modules, onClose }: { modules: ModuleInfo[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [category, setCategory] = useState("");
  const [place, setPlace] = useState<AddressValue>({ region: "", city: "", address: "", lat: null, lng: null });
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const ownerLookup = usePhoneLookup(ownerPhone);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [days, setDays] = useState("30");
  const [picked, setPicked] = useState<string[]>(["booking"]);

  const create = useMutation({
    mutationFn: () =>
      api("/superadmin/businesses", json("POST", {
        name: name.trim(),
        slug,
        category_id: Number(category),
        region: place.region || null,
        city: place.city.trim() || null,
        address: place.address.trim() || null,
        lat: place.lat,
        lng: place.lng,
        owner_full_name: ownerName.trim(),
        owner_phone: normalizePhone(ownerPhone),
        owner_password: ownerPassword.trim() || null,
        modules: picked,
        subscription_days: days ? Number(days) : null,
      })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["superadmin"] })   // ro'yxat va menyudagi sonlar;
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  // 1-qadam — turi. Nom yozuvi, misol va havola shu turga moslashadi
  const active = categories.data?.filter((c) => c.is_active) ?? [];
  const type = active.find((c) => String(c.id) === category);
  const w = wordingFor(type);
  const chooseType = (id: string) => {
    setCategory(id);
    if (!slugEdited) setSlug(slugFor(name, active.find((c) => String(c.id) === id)));
  };

  return (
    <Modal title={type ? t("Yangi {a}", { a: w.noun.toLowerCase() }) : t("Yangi muassasa")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <fieldset>
          <legend className="text-sm">{t("1. Muassasa turi")}</legend>
          {categories.isPending && <p className="mt-1 text-sm text-muted">{t("Yuklanmoqda...")}</p>}
          {categories.error && <ErrorNote error={categories.error} />}
          <div className="mt-1 flex flex-wrap gap-2">
            {active.map((c) => {
              const on = String(c.id) === category;
              return (
                <label key={c.id}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40 ${
                    on ? "border-primary bg-primary text-white" : "border-line bg-white hover:border-primary/60"}`}>
                  <input type="radio" name="business-type" value={c.id} checked={on} required className="sr-only"
                    onChange={() => chooseType(String(c.id))} />
                  {typeName(c)}
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset disabled={!type} className="space-y-3 disabled:opacity-50">
        <label className="block text-sm">2. {w.noun}{" "}{t("nomi")}
          <input className={inputClass} required minLength={2} maxLength={120} value={name} placeholder={w.example}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(slugFor(e.target.value, type));
            }} />
        </label>
        <label className="block text-sm">{t("Havola nomi (lotin harflari)")}
          <input className={inputClass} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={140} value={slug}
            placeholder={slugFor("nomi", type)}
            onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }} />
          <span className="mt-1 block text-xs text-muted">
            {t("Avtomatik yasaladi, tur so'zi qo'shiladi. Kerak bo'lsa o'zgartiring.")}
            {slugEdited && name && (
              <button type="button" className="ml-2 text-primary underline"
                onClick={() => { setSlugEdited(false); setSlug(slugFor(name, type)); }}>{t("Nomdan qayta yasash")}</button>
            )}
          </span>
        </label>
        <AddressFields value={place} onChange={setPlace} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t("Direktor ismi")}
            <input className={inputClass} required minLength={2} maxLength={120} value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Direktor telefoni (login)")}
            <input className={inputClass} type="tel" required placeholder="90 123 45 67" value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)} />
          </label>
        </div>
        <PhoneOwnerHint lookup={ownerLookup.data} mode="assign" />
        <PasswordInput label={t("Direktorning boshlang'ich paroli")} value={ownerPassword} onChange={setOwnerPassword} />
        <label className="block text-sm">{t("Obuna (kun, bo'sh qolsa muddatsiz)")}
          <input className={inputClass} type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <fieldset>
          <legend className="text-sm">{t("Modullar")}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {modules.map((m) => (
              <label key={m.code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={picked.includes(m.code)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, m.code] : picked.filter((x) => x !== m.code))} />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
        {type && place.lat === null && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("Xaritada {a} joyini belgilang — lokatsiyasiz ochib bo'lmaydi (mijoz ilovasida ko'rinmaydi).", { a: w.noun.toLowerCase() })}
          </p>
        )}
        {create.error && <ErrorNote error={create.error} />}
        <Button type="submit" disabled={create.isPending || !type || place.lat === null} className="w-full">
          {type ? t("{a}ni yaratish", { a: w.noun }) : t("Avval turini tanlang")}
        </Button>
        </fieldset>
      </form>
    </Modal>
  );
}

type Tab = "info" | "subscription" | "modules" | "staff";

const TABS: { id: Tab; label: string }[] = [
  { id: "info", label: t("Ma'lumot") },
  { id: "subscription", label: t("Obuna") },
  { id: "modules", label: t("Modullar") },
  { id: "staff", label: t("Xodimlar") },
];

export function BusinessDialog({ business: b, modules, onClose }: {
  business: BusinessAdmin;
  modules: ModuleInfo[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("info");
  const bizType = useCategories().data?.find((tx) => tx.id === b.category_id);
  const queryClient = useQueryClient();
  const refreshAll = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["superadmin"] }),
    queryClient.invalidateQueries({ queryKey: ["members", b.id] }),
  ]);
  return (
    <Modal title={b.name} onClose={onClose}>
      <p className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{t("Direktor: {a}", { a: b.owner_name ?? t("yo'q") })}</span>
        <StatusBadge b={b} />
      </p>
      <CredentialsBox title={t("Direktorning kirish ma'lumotlari (www.ariqalqon.uz)")} businessId={b.id}
        memberId={b.owner_member_id} phone={b.owner_phone} status={b.owner_password_status}
        changedAt={b.owner_password_changed_at} canView onChanged={refreshAll} />
      <OwnerChange business={b} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "info" && <InfoTab business={b} />}
      {tab === "subscription" && <SubscriptionTab business={b} />}
      {tab === "modules" && <ModulesTab business={b} modules={modules} />}
      {tab === "staff" && (
        <VocabContext.Provider value={panelVocab({ business_kind: bizType?.kind ?? "salon", staff_titles: bizType?.staff_titles ?? [], staff_word: bizType?.staff_word, business_type_name: bizType?.name_uz })}>
          <MembersPanel businessId={b.id} canManageManagers />
        </VocabContext.Provider>
      )}
    </Modal>
  );
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["superadmin"] })   // ro'yxat va menyudagi sonlar;
}

function InfoTab({ business: b }: { business: BusinessAdmin }) {
  const refresh = useRefresh();
  const categories = useCategories();
  const [name, setName] = useState(b.name);
  const [category, setCategory] = useState(String(b.category_id));
  const [place, setPlace] = useState<AddressValue>({
    region: b.region ?? "", city: b.city ?? "", address: b.address ?? "", lat: b.lat, lng: b.lng,
  });

  const save = useMutation({
    mutationFn: () =>
      api(`/superadmin/businesses/${b.id}`, json("PATCH", {
        name: name.trim(),
        category_id: Number(category),
        region: place.region || null,
        city: place.city.trim() || null,
        address: place.address.trim() || null,
        lat: place.lat,
        lng: place.lng,
      })),
    onSuccess: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">{t("Nomi")}
        <input className={inputClass} required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-sm">{t("Turi")}
        <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{typeLabel(c)}</option>)}
        </select>
      </label>
      <AddressFields value={place} onChange={setPlace} />
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
        {save.isSuccess && <span className="text-sm text-success">{t("Saqlandi")}</span>}
      </div>
    </form>
  );
}

/** Tarif yoki maxsus narx: direktor Payme/Click orqali shu narx x oylar (paket chegirmasi bilan) to'laydi */
function MonthlyFeeForm({ business: b, onSave, saving }: {
  business: BusinessAdmin; onSave: (body: { plan_id: number } | { monthly_fee: number }) => void; saving: boolean;
}) {
  const plans = useBillingPlans();
  const [choice, setChoice] = useState(b.plan_id ? String(b.plan_id) : "custom");
  const [fee, setFee] = useState(String(b.monthly_fee));
  const value = Number(fee.replace(/\s/g, ""));
  const valid = fee.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= 100_000_000;
  const custom = choice === "custom";
  const unchanged = custom ? b.plan_id === null && value === b.monthly_fee : Number(choice) === b.plan_id;
  const visible = (plans.data ?? []).filter((p) => p.is_active || p.id === b.plan_id);
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block w-56">{t("Tarif")}
          <select className={inputClass} value={choice} onChange={(e) => setChoice(e.target.value)}>
            {visible.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.monthly_fee)}</option>)}
            <option value="custom">{t("Maxsus narx (kelishilgan)")}</option>
          </select>
        </label>
        {custom && (
          <label className="block w-40">{t("Oylik narx (so'm)")}
            <input className={inputClass} inputMode="numeric" value={fee}
              onChange={(e) => setFee(e.target.value.replace(/[^\d\s]/g, ""))} />
          </label>
        )}
        <Button variant="secondary" disabled={unchanged || (custom && !valid) || saving}
          onClick={() => onSave(custom ? { monthly_fee: value } : { plan_id: Number(choice) })}>
          {t("Saqlash")}
        </Button>
      </div>
      <p className="text-xs text-muted">
        {t("Hozir: {a} / oy", { a: formatMoney(b.monthly_fee) })} · {b.plan_name ?? t("maxsus narx")}.{" "}
        {t("Tariflar narxi \"Narxlar\" sahifasida.")}
      </p>
    </div>
  );
}

function SubscriptionTab({ business: b }: { business: BusinessAdmin }) {
  const refresh = useRefresh();
  const [date, setDate] = useState(b.subscription_ends_at ? dayOf(b.subscription_ends_at) : "");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const base = `/superadmin/businesses/${b.id}`;

  const renewed = (r: BusinessAdmin) => {
    if (r.subscription_ends_at) setDate(dayOf(r.subscription_ends_at));
    return refresh();
  };
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`${base}/subscription`, json("PATCH", body)),
    onSuccess: () => {
      setConfirming(false);
      return refresh();
    },
  });
  const block = useMutation({
    mutationFn: (status: string) => api(`${base}/status`, json("PATCH", { status })),
    onSuccess: refresh,
  });
  const error = update.error ?? block.error;

  return (
    <div className="space-y-4 text-sm">
      <p>
        {t("Hozir: {a} {b}", { a: b.subscription_ends_at ? t("{a} gacha", { a: formatDate(b.subscription_ends_at) }) : "muddatsiz", b: !b.is_active && t(" (to'xtatilgan)") })}
      </p>
      <MonthlyFeeForm business={b} onSave={(body) => update.mutate(body)} saving={update.isPending} />
      <RenewForm business={b} onDone={renewed} />
      <p className="text-xs text-muted">{t("Quyidagilar pulsiz tuzatish uchun (to'lov tarixiga yozilmaydi):")}</p>
      <label className="block max-w-xs">{t("Aniq sana (kun oxirigacha)")}
        <input className={inputClass} type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!date || update.isPending}
          onClick={() => update.mutate({ subscription_ends_at: `${date}T23:59:59+05:00`, is_active: true })}>
          {t("Sanani saqlash")}
        </Button>
        <Button variant="secondary" disabled={update.isPending}
          onClick={() => { setDate(""); update.mutate({ subscription_ends_at: null, is_active: true }); }}>
          {t("Muddatsiz qilish")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {b.is_active ? (
          confirming ? (
            <>
              <Button variant="danger" onClick={() => update.mutate({ is_active: false })}>{t("Ha, to'xtatish")}</Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>{t("Yo'q")}</Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>{t("Obunani to'xtatish")}</Button>
          )
        ) : (
          <Button onClick={() => update.mutate({ is_active: true })}>{t("Obunani yoqish")}</Button>
        )}
        {b.status === "blocked" ? (
          <Button variant="secondary" onClick={() => block.mutate("active")}>{t("Blokdan chiqarish")}</Button>
        ) : (
          <Button variant="danger" onClick={() => block.mutate("blocked")}>{t("Bloklash")}</Button>
        )}
        <Button variant="danger" className="flex items-center gap-1" onClick={() => setDeleting(true)}>
          <Trash2 size={15} aria-hidden />{" "}{t("O'chirish")}
        </Button>
      </div>
      <p className="text-xs text-muted">{t("To'xtatish yoki bloklash ma'lumotni o'chirmaydi. Blokni to'lov ochmaydi.")}</p>
      {deleting && <DeleteBox business={b} onCancel={() => setDeleting(false)} />}
      {error && <ErrorNote error={error} />}
      <div className="border-t border-line pt-4">
        <PaymentHistory businessId={b.id} />
      </div>
    </div>
  );
}

// O'chirish: ortga qaytarib bo'lmaydi, shuning uchun nomini qayta yozib tasdiqlash
function DeleteBox({ business: b, onCancel }: { business: BusinessAdmin; onCancel: () => void }) {
  const refresh = useRefresh();
  const [typed, setTyped] = useState("");
  const remove = useMutation({
    mutationFn: () => api(`/superadmin/businesses/${b.id}`, json("DELETE", { confirm_name: typed })),
    onSuccess: refresh,                 // ro'yxatdan yo'qoladi va oyna o'zi yopiladi
  });
  const match = typed.trim() === b.name.trim();

  return (
    <div role="alertdialog" aria-labelledby="delete-title"
      className="space-y-3 rounded-xl border border-danger/40 bg-danger/5 p-4">
      <p id="delete-title" className="font-medium text-danger">
        {t("Haqiqatan ham ushbu muassasani o'chirmoqchimisiz? Bu amalni ortga qaytarib bo'lmaydi.")}
      </p>
      <p className="text-muted">
        {t("Butunlay o'chadi: bronlar, to'lovlar, kassa va xarajatlar, ombor, oyliklar, xizmatlar, rasmlar, xodimlarning shu salondagi a'zoligi ({a} ta). Direktor va xodimlarning shaxsiy hisoblari qoladi. Hisobot kerak bo'lsa, avval direktor panelidan Excel'ga yuklab oling.", { a: b.staff_count })}
      </p>
      <label className="block">{t("Tasdiqlash uchun nomini yozing:")}{" "}<b className="select-all">{b.name}</b>
        <input className={inputClass} value={typed} autoComplete="off" data-autofocus
          onChange={(e) => { setTyped(e.target.value); remove.reset(); }} />
      </label>
      {remove.error && <ErrorNote error={remove.error} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" disabled={!match || remove.isPending} onClick={() => remove.mutate()}>
          {remove.isPending ? t("O'chirilmoqda...") : t("Ha, butunlay o'chirish")}
        </Button>
        <Button variant="secondary" disabled={remove.isPending} onClick={onCancel}>{t("Bekor qilish")}</Button>
      </div>
    </div>
  );
}

function ModulesTab({ business: b, modules }: { business: BusinessAdmin; modules: ModuleInfo[] }) {
  const refresh = useRefresh();
  const toggle = useMutation({
    mutationFn: ({ code, enabled }: { code: string; enabled: boolean }) =>
      api(`/superadmin/businesses/${b.id}/modules/${code}`, json("PUT", { enabled })),
    onSettled: refresh,
  });

  return (
    <>
      <div className="space-y-2">
        {modules.map((m) => (
          <label key={m.code} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" disabled={toggle.isPending}
              checked={b.modules.includes(m.code)}
              onChange={(e) => toggle.mutate({ code: m.code, enabled: e.target.checked })} />
            {m.name}
          </label>
        ))}
      </div>
      {toggle.error && <div className="mt-3"><ErrorNote error={toggle.error} /></div>}
    </>
  );
}
