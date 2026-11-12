// Tezkor qabul: yozilmasdan kelgan mijoz. Xizmat tanlanadi — hozir bo'sh mutaxassislar ko'rinadi, bron shu
// daqiqadan boshlanadi va darhol "keldi" holatida ochiladi (to'lov va chek shu zahoti).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, ApiError, json } from "../../api/client";
import type { Appointment, Client, Membership, ReceptionOptions, WalkInOption } from "../../api/types";
import { formatMoney, formatTime, normalizePhone } from "../../components/format";
import { Badge, Button, Empty, ErrorNote, inputClass, Spinner } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { dyn, t } from "../../i18n";
import { useVocab } from "../vocab";

export function WalkInDialog({ membership, onClose, onBooked }: {
  membership: Membership;
  onClose: () => void;
  onBooked: (appointment: Appointment) => void;
}) {
  const b = membership.business_id;
  const v = useVocab();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [memberId, setMemberId] = useState<number | null>(null);      // null = istalgan bo'sh mutaxassis
  const [note, setNote] = useState("");

  const options = useQuery({
    queryKey: ["reception-options", b],
    queryFn: () => api<ReceptionOptions>(`/businesses/${b}/reception/options`),
  });
  const services = options.data?.services ?? [];
  // Boshida kimdir bajaradigan birinchi xizmat tanlanadi (bo'sh ro'yxat chiqmasin)
  const selectedService = serviceId
    ?? services.find((s) => options.data?.staff.some((m) => m.service_ids.includes(s.id)))?.id
    ?? services[0]?.id ?? null;

  const staff = useQuery({
    queryKey: ["walk-in", b, selectedService],
    enabled: selectedService !== null,
    refetchInterval: 20_000,                       // kimdir bo'shasa yoki band bo'lsa, ro'yxat o'zi yangilanadi
    queryFn: () => api<WalkInOption[]>(`/businesses/${b}/reception/walk-in?service_id=${selectedService}`),
  });
  const free = staff.data?.filter((s) => s.free) ?? [];
  const anyAvailable = free.some((s) => s.on_shift);
  const chosen = free.find((s) => s.member_id === memberId) ?? null;
  const canSubmit = chosen !== null || (memberId === null && anyAvailable);

  const digits = phone.replace(/\D/g, "");
  const canSearch = membership.permissions.includes("clients.view") && digits.length >= 3 && name.trim().length < 2;
  const clients = useQuery({
    queryKey: ["clients", b, digits],
    enabled: canSearch,
    queryFn: () => api<Client[]>(`/businesses/${b}/clients?q=${encodeURIComponent(digits)}`),
  });

  const book = useMutation({
    mutationFn: () => api<Appointment>(`/businesses/${b}/reception/walk-in`, json("POST", {
      service_id: selectedService,
      member_id: chosen?.member_id ?? null,
      client_name: name,
      client_phone: normalizePhone(phone),
      note: note.trim() || null,
    })),
    onSuccess: async (appointment) => {
      await queryClient.invalidateQueries({ queryKey: ["calendar", b] });
      await queryClient.invalidateQueries({ queryKey: ["appointments", b] });
      onBooked(appointment);
    },
    onError: (e) => {
      // Mutaxassisni boshqa qabulxona hozirgina band qildi
      if (e instanceof ApiError && e.status === 409) {
        setMemberId(null);
        void staff.refetch();
      }
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) book.mutate();
  };

  return (
    <Modal title={t("Tezkor qabul")} onClose={onClose}>
      {options.isPending && <Spinner />}
      {options.error && <ErrorNote error={options.error} />}
      {options.data && services.length === 0 && <Empty>{t("Avval xizmat qo'shing, keyin bron qilish mumkin.")}</Empty>}

      {services.length > 0 && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted">
            {t("Yozilmasdan kelgan {a} hozir bo'sh mutaxassisga shu daqiqadan yoziladi.", { a: v.clientOne.toLowerCase() })}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">{t("Telefon")}
              <input className={inputClass} type="tel" required data-autofocus placeholder="90 123 45 67" value={phone}
                onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="block text-sm">{v.clientOne}{" "}{t("ismi")}
              <input className={inputClass} required minLength={2} maxLength={120} value={name}
                onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          {canSearch && (clients.data?.length ?? 0) > 0 && (
            <ul className="rounded-lg border border-line text-sm">
              {clients.data!.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { setPhone(c.phone); setName(c.full_name); }}
                    className="flex w-full justify-between px-3 py-2 text-left hover:bg-page">
                    <span>{c.full_name}</span>
                    <span className="text-muted tabular-nums">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="block text-sm">{v.serviceOne}
            <select className={inputClass} value={selectedService ?? ""}
              onChange={(e) => { setServiceId(Number(e.target.value)); setMemberId(null); }}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {t("{a} · {b} daqiqa · {c}", { a: s.name, b: s.duration_min, c: formatMoney(s.price) })}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="text-sm">
            <legend>{t("Kim qabul qiladi")}</legend>
            {staff.isPending && <Spinner />}
            {staff.error && <ErrorNote error={staff.error} />}
            {staff.data?.length === 0 && <Empty>{t("Bu xizmatni bajaradigan mutaxassis yo'q")}</Empty>}
            {staff.data && staff.data.length > 0 && (
              <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
                <li>
                  <label className={`flex items-center gap-3 px-3 py-2 ${anyAvailable ? "cursor-pointer hover:bg-page" : "opacity-50"}`}>
                    <input type="radio" name="walk-in-staff" disabled={!anyAvailable} checked={memberId === null}
                      onChange={() => setMemberId(null)} />
                    <span className="flex-1">{v.staffAny}</span>
                    {!anyAvailable && (
                      <Badge tone="red">{free.length > 0 ? t("Ish vaqtida bo'sh mutaxassis yo'q") : t("Hozir hamma band")}</Badge>
                    )}
                  </label>
                </li>
                {staff.data.map((s) => (
                  <li key={s.member_id}>
                    <label className={`flex items-center gap-3 px-3 py-2 ${s.free ? "cursor-pointer hover:bg-page" : "opacity-60"}`}>
                      <input type="radio" name="walk-in-staff" disabled={!s.free} checked={memberId === s.member_id}
                        onChange={() => setMemberId(s.member_id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words">{s.full_name}</span>
                        <span className="block text-xs text-muted">
                          {[dyn(s.title), formatMoney(s.price)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {!s.free
                        ? <Badge tone="red">{s.busy_until ? t("Band, {a} gacha", { a: formatTime(s.busy_until) }) : t("Band")}</Badge>
                        : s.on_shift ? <Badge tone="green">{t("Bo'sh")}</Badge>
                          : <Badge tone="amber">{t("Ish vaqtida emas")}</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <label className="block text-sm">{t("Izoh")}
            <input className={inputClass} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {book.error && <ErrorNote error={book.error} />}
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={!canSubmit || book.isPending}>{t("Qabul qilish")}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
