// Kutish ro'yxati (qabulxona): navbatdagilar, bo'sh vaqt topilganlar ("taklif"), bir bosishda bron.
// Bo'sh vaqtni server o'zi topadi: bron bekor qilinganda darhol va har daqiqada (sql/052_waitlist.sql).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Phone, Plus, RefreshCw, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { Membership, ReceptionOptions, WaitlistEntry } from "../../api/types";
import { formatDate, formatTime, normalizePhone, todayIso } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, Empty, ErrorNote, inputClass, Spinner, Tabs } from "../../components/ui";
import { useVocab } from "../vocab";

import { localized, t } from "../../i18n";

export interface WaitlistPrefill {
  serviceId?: number | null;
  memberId?: number | null;
  day?: string;
  name?: string;
  phone?: string;
}

const STATUS: Record<WaitlistEntry["status"], string> = localized({
  waiting: "Kutmoqda", offered: "Bo'sh vaqt topildi", booked: "Bron qilindi", expired: "Muddati o'tdi",
  cancelled: "Bekor qilindi",
});
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : "");
const shortDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export function WaitlistDialog({ membership, prefill, onClose }: {
  membership: Membership;
  prefill?: WaitlistPrefill | null;
  onClose: () => void;
}) {
  const b = membership.business_id;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"active" | "done">("active");
  const [adding, setAdding] = useState(!!prefill);
  const list = useQuery({
    queryKey: ["waitlist", b, tab],
    queryFn: () => api<WaitlistEntry[]>(`/businesses/${b}/waitlist?state=${tab}`),
    refetchInterval: 30_000,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["waitlist", b] });
    await queryClient.invalidateQueries({ queryKey: ["waitlist-summary", b] });
    await queryClient.invalidateQueries({ queryKey: ["calendar", b] });
  };
  const scan = useMutation({ mutationFn: () => api(`/businesses/${b}/waitlist/scan`, { method: "POST" }), onSuccess: refresh });
  const book = useMutation({
    mutationFn: (id: number) => api(`/businesses/${b}/waitlist/${id}/book`, json("POST", {})),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: (id: number) => api(`/businesses/${b}/waitlist/${id}/cancel`, { method: "POST" }),
    onSuccess: refresh,
  });
  const error = scan.error ?? book.error ?? cancel.error;

  return (
    <Modal title={t("Kutish ro'yxati")} onClose={onClose}>
      {adding ? (
        <AddForm membership={membership} prefill={prefill} onDone={async () => { setAdding(false); setTab("active"); await refresh(); }}
                 onCancel={() => setAdding(false)} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Tabs tabs={[{ id: "active", label: t("Navbatda") }, { id: "done", label: t("Yopilgan") }]} value={tab} onChange={setTab} />
            <div className="flex gap-2">
              <Button variant="secondary" aria-label={t("Bo'sh vaqtni tekshirish")} title={t("Bo'sh vaqtni tekshirish")}
                      disabled={scan.isPending} onClick={() => scan.mutate()}>
                <RefreshCw size={16} aria-hidden className={scan.isPending ? "animate-spin" : ""} />
              </Button>
              <Button className="flex items-center gap-1" onClick={() => setAdding(true)}>
                <Plus size={16} aria-hidden /> {t("Qo'shish")}
              </Button>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted">
            {t("Bron bekor qilinsa yoki vaqt bo'shasa, tizim navbat tartibida mos mijozni topadi. Ilovasi bor mijozga xabar o'zi boradi.")}
          </p>
          {error && <div className="mb-3"><ErrorNote error={error} /></div>}
          {list.isPending && <Spinner />}
          {list.data?.length === 0 && <Empty>{tab === "active" ? t("Navbatda hech kim yo'q") : t("Yopilgan yozuvlar yo'q")}</Empty>}
          <ul className="space-y-2">
            {list.data?.map((w) => (
              <li key={w.id} className={`rounded-lg border px-3 py-2.5 text-sm ${w.status === "offered" ? "border-success bg-success/10" : "border-line"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {w.position && <span className="mr-1.5 text-muted tabular-nums">#{w.position}</span>}
                      {w.client_name}
                      {w.source === "app" && <span className="ml-1.5"><Badge tone="green">{t("Ilovadan")}</Badge></span>}
                    </p>
                    <p className="text-muted">
                      {w.service_name} · {w.member_name ?? t("istalgan usta")}
                    </p>
                    <p className="text-xs text-muted tabular-nums">
                      {w.date_from === w.date_to ? shortDay(w.date_from) : `${shortDay(w.date_from)}–${shortDay(w.date_to)}`}
                      {w.time_from ? `, ${hhmm(w.time_from)}–${hhmm(w.time_to)}` : `, ${t("kun bo'yi")}`}
                      {w.note ? ` · ${w.note}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted">{STATUS[w.status]}</span>
                </div>
                {w.status === "offered" && w.offered_starts_at && (
                  <p className="mt-2 font-medium text-success tabular-nums">
                    {t("Bo'sh vaqt: {a}, {b} · {c}", { a: formatDate(w.offered_starts_at), b: formatTime(w.offered_starts_at),
                                                       c: w.offered_member_name ?? "" })}
                  </p>
                )}
                {(w.status === "waiting" || w.status === "offered") && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {w.status === "offered" && (
                      <Button className="flex items-center gap-1" disabled={book.isPending} onClick={() => book.mutate(w.id)}>
                        <CalendarCheck size={16} aria-hidden /> {t("Bron qilish")}
                      </Button>
                    )}
                    {w.client_phone && (
                      <a href={`tel:${w.client_phone}`} className="flex items-center gap-1 rounded-lg border border-line px-3 py-2 hover:bg-page">
                        <Phone size={14} aria-hidden /> {w.client_phone}
                      </a>
                    )}
                    <Button variant="secondary" className="flex items-center gap-1" disabled={cancel.isPending}
                            onClick={() => cancel.mutate(w.id)}>
                      <X size={14} aria-hidden /> {t("Navbatdan chiqarish")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function AddForm({ membership, prefill, onDone, onCancel }: {
  membership: Membership;
  prefill?: WaitlistPrefill | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const b = membership.business_id;
  const v = useVocab();
  const options = useQuery({
    queryKey: ["reception-options", b],
    queryFn: () => api<ReceptionOptions>(`/businesses/${b}/reception/options`),
  });
  const [name, setName] = useState(prefill?.name ?? "");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [serviceId, setServiceId] = useState<number | null>(prefill?.serviceId ?? null);
  const [memberId, setMemberId] = useState<number | null>(prefill?.memberId ?? null);
  const [dateFrom, setDateFrom] = useState(prefill?.day && prefill.day >= todayIso() ? prefill.day : todayIso());
  const [dateTo, setDateTo] = useState(prefill?.day && prefill.day >= todayIso() ? prefill.day : todayIso());
  const [allDay, setAllDay] = useState(true);
  const [timeFrom, setTimeFrom] = useState("10:00");
  const [timeTo, setTimeTo] = useState("14:00");
  const [note, setNote] = useState("");

  const services = options.data?.services ?? [];
  const service = serviceId ?? services[0]?.id ?? null;
  const masters = options.data?.staff.filter((s) => service !== null && s.service_ids.includes(service)) ?? [];

  const save = useMutation({
    mutationFn: () => api(`/businesses/${b}/waitlist`, json("POST", {
      client_name: name.trim(), client_phone: normalizePhone(phone), service_id: service,
      member_id: masters.some((m) => m.id === memberId) ? memberId : null,
      date_from: dateFrom, date_to: dateTo < dateFrom ? dateFrom : dateTo,
      time_from: allDay ? null : timeFrom, time_to: allDay ? null : timeTo, note: note.trim() || null,
    })),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{t("Telefon")}
          <input className={inputClass} type="tel" required placeholder="90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="block text-sm">{t("Mijoz ismi")}
          <input className={inputClass} required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{t("Xizmat")}
          <select className={inputClass} value={service ?? ""} onChange={(e) => setServiceId(Number(e.target.value))}>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">{v.staffOne}
          <select className={inputClass} value={memberId ?? ""} onChange={(e) => setMemberId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{v.staffAny}</option>
            {masters.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{t("Qaysi kundan")}
          <input className={inputClass} type="date" required min={todayIso()} value={dateFrom}
                 onChange={(e) => { setDateFrom(e.target.value); if (dateTo < e.target.value) setDateTo(e.target.value); }} />
        </label>
        <label className="block text-sm">{t("Qaysi kungacha")}
          <input className={inputClass} type="date" required min={dateFrom} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> {t("Kun bo'yi istalgan vaqt")}
      </label>
      {!allDay && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">{t("Soat ...dan")}
            <input className={inputClass} type="time" step={900} required value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Soat ...gacha")}
            <input className={inputClass} type="time" step={900} required value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </label>
        </div>
      )}
      <label className="block text-sm">{t("Izoh")}
        <input className={inputClass} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending || service === null}>{t("Navbatga qo'shish")}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>{t("Orqaga")}</Button>
      </div>
    </form>
  );
}
