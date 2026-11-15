// Qabulxona rejimi (2026-11-15): xodim paneli muassasada Administrator bor-yo'qligiga moslashadi.
//   Administrator bor  — bron va to'lov tugmalari o'chiq, izoh ko'rsatiladi (server ham 403 qaytaradi).
//   Administrator yo'q — xodim o'ziga bron qo'shadi va o'z mijozidan to'lov oladi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { Membership, Slot } from "../../api/types";
import { formatDate, formatMoney, normalizePhone, todayIso } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";
import { PaymentPanel } from "../finance/PaymentPanel";
import { useVocab } from "../vocab";

import { t } from "../../i18n";

type MyService = { service_id: number; name: string; duration_min: number; custom_duration: number | null; price: number };
type MyClient = { client_id: number; full_name: string; phone: string | null; visits: number; last_visit: string | null; next_visit: string | null };

const MY_CLIENTS: Record<string, string> = { clinic: "Bemorlarim", pharmacy: "Xaridorlarim" };

export const canBookSelf = (m: Membership) => m.permissions.includes("appointments.manage_own");
export const canTakePayment = (m: Membership) => m.permissions.includes("payments.accept_own");

/** Administrator bor bo'lsa — nega tugmalar o'chiqligini tushuntiradi */
export function ReceptionNotice({ membership }: { membership: Membership }) {
  const v = useVocab();
  if (!membership.has_reception) return null;
  return (
    <p className="mb-3 flex items-start gap-2 rounded-lg bg-page px-3 py-2 text-sm text-muted">
      <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
      {t("Bu muassasada {a} ishlaydi: yangi bronlar va to'lovlarni u qabul qiladi. Siz o'z jadvalingiz, bronlaringiz va mijozlaringizni ko'rasiz.",
        { a: v.receptionOne.toLowerCase() })}
    </p>
  );
}

/** Xodim o'ziga bron qo'shadi: xizmat -> sana -> bo'sh vaqt -> mijoz */
export function SelfBookingDialog({ membership, onClose }: { membership: Membership; onClose: () => void }) {
  const v = useVocab();
  const b = membership.business_id;
  const queryClient = useQueryClient();
  const [serviceId, setServiceId] = useState("");
  const [day, setDay] = useState(todayIso());
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const services = useQuery({ queryKey: ["my-services", b], queryFn: () => api<MyService[]>(`/businesses/${b}/my-services`) });
  const slots = useQuery({
    queryKey: ["my-slots", b, serviceId, day],
    queryFn: () => api<{ slots: Slot[] }>(`/businesses/${b}/my-slots?service_id=${serviceId}&date=${day}`),
    enabled: !!serviceId,
  });
  const create = useMutation({
    mutationFn: () => api(`/businesses/${b}/reception/appointments`, json("POST", {
      member_id: membership.member_id, service_id: Number(serviceId), starts_at: slot!.starts_at,
      client_name: name.trim(), client_phone: normalizePhone(phone),
    })),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["appointments", b] }),
        queryClient.invalidateQueries({ queryKey: ["my-clients", b] }),
      ]);
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (slot) create.mutate();
  };

  return (
    <Modal title={t("Yangi bron")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {services.error && <ErrorNote error={services.error} />}
        {services.data?.length === 0 && <Empty>{t("Sizga hali xizmat biriktirilmagan. Direktorga murojaat qiling.")}</Empty>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t("Xizmat")}
            <select className={inputClass} required value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); setSlot(null); }}>
              <option value="">{t("Tanlang")}</option>
              {services.data?.map((s) => (
                <option key={s.service_id} value={s.service_id}>{s.name} · {formatMoney(s.price)}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">{t("Sana")}
            <input type="date" className={inputClass} required min={todayIso()} value={day}
              onChange={(e) => { if (e.target.value) { setDay(e.target.value); setSlot(null); } }} />
          </label>
        </div>
        {serviceId && (
          <fieldset>
            <legend className="text-sm">{t("Bo'sh vaqt")}</legend>
            {slots.isPending && <Spinner />}
            {slots.error && <ErrorNote error={slots.error} />}
            {slots.data?.slots.length === 0 && <p className="mt-1 text-sm text-muted">{t("Bu kunga bo'sh vaqt yo'q")}</p>}
            <div className="mt-1 flex flex-wrap gap-2">
              {slots.data?.slots.map((s) => (
                <button key={s.starts_at} type="button" onClick={() => setSlot(s)} aria-pressed={slot?.starts_at === s.starts_at}
                  className={`rounded-lg border px-3 py-1.5 text-sm tabular-nums ${
                    slot?.starts_at === s.starts_at ? "border-primary bg-primary text-white" : "border-line bg-white hover:border-primary/60"}`}>
                  {s.time}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t("{a} ismi", { a: v.clientOne })}
            <input className={inputClass} required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Telefon")}
            <input className={inputClass} type="tel" required placeholder="90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        {create.error && <ErrorNote error={create.error} />}
        <Button type="submit" className="w-full" disabled={!slot || create.isPending}>
          {slot ? t("{a} ga bron qilish", { a: slot.time }) : t("Vaqtni tanlang")}
        </Button>
      </form>
    </Modal>
  );
}

/** Bron qatoridagi "To'lov" — faqat o'z mijozidan (qabulxonasiz rejim) */
export function SelfPaymentButton({ membership, appointmentId }: { membership: Membership; appointmentId: number }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>{t("To'lov")}</Button>
      {open && (
        <Modal title={t("To'lov")} onClose={() => setOpen(false)}>
          <PaymentPanel membership={membership} appointmentId={appointmentId}
            onPaid={() => void queryClient.invalidateQueries({ queryKey: ["appointments", membership.business_id] })} />
        </Modal>
      )}
    </>
  );
}

/** "Mijozlarim": xodimning o'z bronlaridagi mijozlar */
export function MyClientsPage({ membership }: { membership: Membership }) {
  const v = useVocab();
  const b = membership.business_id;
  const query = useQuery({ queryKey: ["my-clients", b], queryFn: () => api<MyClient[]>(`/businesses/${b}/my-clients`) });
  return (
    <>
      <PageTitle title={t(MY_CLIENTS[membership.business_kind] ?? "Mijozlarim")} hint={t("Sizga yozilgan va sizda bo'lgan {a}", { a: v.clients.toLowerCase() })} />
      <Card>
        {query.isPending && <Spinner />}
        {query.error && <ErrorNote error={query.error} />}
        {query.data?.length === 0 && <Empty>{t("Hali mijoz yo'q")}</Empty>}
        <ul className="divide-y divide-line">
          {query.data?.map((c) => (
            <li key={c.client_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{c.full_name}</span>
                {c.phone && <a className="text-primary" href={`tel:${c.phone}`}>{c.phone}</a>}
              </span>
              <span className="text-muted">
                {t("Tashriflar: {a}", { a: c.visits })}
                {c.last_visit ? ` · ${t("oxirgisi {a}", { a: formatDate(c.last_visit) })}` : ""}
              </span>
              {c.next_visit && <span className="text-primary">{t("Keyingi: {a}", { a: formatDate(c.next_visit) })}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
