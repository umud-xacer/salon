// Filiallar (sql/064_director_branches.sql): direktor filialni o'zi qo'shadi. Tur, tarif, ish vaqti va modullar
// asosiy muassasadan olinadi. Yangi filialga bepul imtiyozli kunlar beriladi (standart 5), keyin tarmoq muddatigacha
// (odatda 1-sana) kunbay hisob — to'lanmasa filial yopiladi va to'lov oynasi chiqadi. Keyingi oydan tarmoq bitta
// chek bilan to'laydi: asosiy + barcha filiallar + pullik modullar.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarClock, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { api, json } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { formatDate, formatMoney } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, Card, ErrorNote, inputClass } from "../../components/ui";
import { AddressFields, type AddressValue } from "../superadmin/AddressFields";

import { t } from "../../i18n";

type Quote = { monthly_fee: number; discount_pct: number; free_until: string | null; charge_to: string | null;
               amount: number; chain_unlimited: boolean };
type Branch = { id: number; slug: string; branch_name: string | null; address: string | null; status: string;
                subscription_ends_at: string | null; operational: boolean };

function Terms({ q }: { q: Quote }) {
  if (q.chain_unlimited) {
    return <p className="text-sm text-muted">{t("Tarmoq obunasi muddatsiz — yangi filial ham bepul ishlaydi.")}</p>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      <li>{t("Filial oylik narxi: {a} (asosiy tarifdan {b}% chegirma)", { a: formatMoney(q.monthly_fee), b: q.discount_pct })}</li>
      {q.free_until && <li>{t("Bepul imtiyozli davr: {a} gacha", { a: formatDate(q.free_until) })}</li>}
      {q.amount > 0 && q.free_until && q.charge_to ? (
        <li className="font-medium text-navy">
          {t("Imtiyozdan keyin {a} – {b} uchun: {c}. Shu summani imtiyoz tugaguncha to'lang, aks holda filial yopiladi.",
            { a: formatDate(q.free_until), b: formatDate(q.charge_to), c: formatMoney(q.amount) })}
        </li>
      ) : q.charge_to && (
        <li>{t("Imtiyoz {a} gacha yetadi — qo'shimcha to'lov yo'q.", { a: formatDate(q.charge_to) })}</li>
      )}
      {q.charge_to && <li className="text-muted">{t("{a} dan boshlab filial oylik chekka qo'shiladi: asosiy, barcha filiallar va modullar bitta to'lovda.", { a: formatDate(q.charge_to) })}</li>}
    </ul>
  );
}

function NewBranchDialog({ headId, quote, onClose, onDone }: {
  headId: number; quote: Quote; onClose: () => void; onDone: (b: Branch) => void;
}) {
  const [name, setName] = useState("");
  const [place, setPlace] = useState<AddressValue>({ region: "", city: "", address: "", lat: null, lng: null });
  const create = useMutation({
    mutationFn: () => api<Branch>(`/businesses/${headId}/branches`, json("POST", {
      branch_name: name.trim(), region: place.region || null, city: place.city.trim() || null,
      address: place.address.trim() || null, lat: place.lat, lng: place.lng,
    })),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <Modal title={t("Yangi filial")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 text-sm">
        <label className="block">{t("Filial nomi (yorliq)")}
          <input className={inputClass} required minLength={2} maxLength={80} value={name}
            placeholder={t("Masalan: Chilonzor filiali")} onChange={(e) => setName(e.target.value)} />
          <span className="mt-1 block text-xs text-muted">{t("Mijozlar ilovada filialni shu nom bilan ajratadi.")}</span>
        </label>
        <AddressFields value={place} onChange={setPlace} />
        {place.lat === null && <p className="text-xs text-amber-700">{t("Xaritada filial joyini belgilang — lokatsiyasiz mijoz ilovasida ko'rinmaydi.")}</p>}
        <div className="rounded-lg border border-line bg-page p-3">
          <p className="mb-1.5 flex items-center gap-1.5 font-medium text-navy"><CalendarClock size={16} aria-hidden />{t("To'lov tartibi")}</p>
          <Terms q={quote} />
        </div>
        <p className="text-xs text-muted">{t("Turi, tarifi, ish vaqti va modullari asosiy muassasadan olinadi. Xodimlar, xizmatlar, ombor va kassa — filialning o'ziniki.")}</p>
        {create.error && <ErrorNote error={create.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={create.isPending || name.trim().length < 2 || place.lat === null}>{t("Filialni yaratish")}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function BranchesCard({ businessId, billingUrl }: { businessId: number; billingUrl: string }) {
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<Branch | null>(null);
  const q = useQuery({ queryKey: ["branches", businessId],
    queryFn: () => api<{ quote: Quote | null; branches: Branch[] }>(`/businesses/${businessId}/branches`) });
  if (!q.data?.quote) return null;                               // tarmoq egasi bo'lmasa — karta yo'q
  const { quote, branches } = q.data;

  const done = async (b: Branch) => {
    setOpen(false);
    setCreated(b);
    await refresh();                                               // filial almashtirgichda paydo bo'lsin
    await qc.invalidateQueries({ queryKey: ["branches", businessId] });
    await qc.invalidateQueries({ queryKey: ["billing"] });
  };

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">{t("Filiallar")}</h2>
          <p className="text-xs text-muted">{t("Yangi filial: {a} kun bepul, keyin oylik chekka qo'shiladi.", { a: quote.free_until ? Math.max(0, Math.round((new Date(quote.free_until).getTime() - Date.now()) / 86_400_000)) : 0 })}</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <span className="inline-flex items-center gap-1"><Plus size={16} aria-hidden />{t("Filial qo'shish")}</span>
        </Button>
      </div>

      {created && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-medium">{t("{a} filiali yaratildi", { a: created.branch_name ?? "" })}</p>
          <p className="mt-1">
            {created.subscription_ends_at
              ? t("Imtiyozli davr {a} gacha. To'lov oynasi \"Obuna\" bo'limida — imtiyoz tugaguncha to'lang.", { a: formatDate(created.subscription_ends_at) })
              : t("Filial ishga tushdi.")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to={`/${created.slug}`} className="font-medium text-primary hover:underline">{t("Filial paneliga o'tish")}</Link>
            <Link to={billingUrl} className="font-medium text-primary hover:underline">{t("To'lov sahifasi")}</Link>
          </div>
        </div>
      )}

      {branches.length === 0 ? (
        <p className="text-sm text-muted">{t("Hali filial yo'q.")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {branches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
              <Building2 size={16} className="text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-navy">{b.branch_name}</span>
                {b.address && <span className="block text-xs text-muted">{b.address}</span>}
              </span>
              {b.status === "blocked" ? <Badge tone="red">{t("Bloklangan")}</Badge>
                : !b.operational ? <Badge tone="red">{t("To'lov kutilmoqda")}</Badge>
                : b.subscription_ends_at ? <Badge tone="green">{t("{a} gacha", { a: formatDate(b.subscription_ends_at) })}</Badge>
                : <Badge tone="gray">{t("Muddatsiz")}</Badge>}
              <Link to={`/${b.slug}`} className="text-xs font-medium text-primary hover:underline">{t("Ochish")}</Link>
            </li>
          ))}
        </ul>
      )}

      {open && <NewBranchDialog headId={businessId} quote={quote} onClose={() => setOpen(false)} onDone={done} />}
    </Card>
  );
}
