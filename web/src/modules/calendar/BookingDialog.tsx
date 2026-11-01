// Qabulxona: mijoz nomidan bron. Usta tanlanmasa, "istalgan usta": serverning o'zi eng kam band ustani topadi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import { api, ApiError, json } from "../../api/client";
import type { Appointment, Client, Membership, ReceptionOptions, Slot } from "../../api/types";
import { formatMoney, normalizePhone, todayIso } from "../../components/format";
import { Button, Empty, ErrorNote, Spinner } from "../../components/ui";
import { Modal } from "./Modal";

export interface BookingPreset {
  day: string;
  memberId?: number;
  time?: string;
}

const field = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-primary";

function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function BookingDialog({ membership, preset, onClose }: {
  membership: Membership;
  preset: BookingPreset;
  onClose: () => void;
}) {
  const b = membership.business_id;
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [memberId, setMemberId] = useState<number | null>(preset.memberId ?? null);
  const [day, setDay] = useState(preset.day);
  const [wantedTime, setWantedTime] = useState(preset.time ?? null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [note, setNote] = useState("");

  const options = useQuery({
    queryKey: ["reception-options", b],
    queryFn: () => api<ReceptionOptions>(`/businesses/${b}/reception/options`),
  });

  // Oynani ochgan usta bajaradigan birinchi xizmat tanlanadi, aks holda ro'yxatdagi birinchisi
  const services = options.data?.services ?? [];
  const presetStaff = options.data?.staff.find((s) => s.id === preset.memberId);
  const selectedService =
    serviceId ?? services.find((s) => presetStaff?.service_ids.includes(s.id))?.id ?? services[0]?.id ?? null;
  const masters = options.data?.staff.filter((s) => selectedService && s.service_ids.includes(selectedService)) ?? [];
  const selectedMember = masters.some((m) => m.id === memberId) ? memberId : null;
  const service = services.find((s) => s.id === selectedService);

  const slots = useQuery({
    queryKey: ["reception-slots", b, selectedService, selectedMember, day],
    enabled: selectedService !== null,
    queryFn: async () => {
      const params = `service_id=${selectedService}&date=${day}`;
      if (selectedMember === null) return api<Slot[]>(`/businesses/${b}/reception/slots?${params}`);
      const r = await api<{ slots: Slot[] }>(`/businesses/${b}/slots?member_id=${selectedMember}&${params}`);
      return r.slots;
    },
  });

  // Kalendarda bosilgan vaqt bo'sh bo'lsa, o'zi belgilanadi
  useEffect(() => {
    if (!wantedTime || !slots.data) return;
    const found = slots.data.find((s) => s.time === wantedTime);
    if (found) setSlot(found);
    setWantedTime(null);
  }, [slots.data, wantedTime]);

  const search = useDebounced(phone.replace(/\D/g, "").length >= 3 ? phone.replace(/\D/g, "") : name.trim());
  const canSearch = membership.permissions.includes("clients.view") && search.length >= 2;
  const clients = useQuery({
    queryKey: ["clients", b, search],
    enabled: canSearch && slotClientUnset(phone, name),
    queryFn: () => api<Client[]>(`/businesses/${b}/clients?q=${encodeURIComponent(search)}`),
  });

  const book = useMutation({
    mutationFn: () =>
      api<Appointment>(
        `/businesses/${b}/reception/appointments`,
        json("POST", {
          member_id: selectedMember,
          service_id: selectedService,
          starts_at: slot!.starts_at,
          client_name: name,
          client_phone: normalizePhone(phone),
          note: note.trim() || null,
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["calendar", b] });
      await queryClient.invalidateQueries({ queryKey: ["appointments", b] });
      onClose();
    },
    onError: (e) => {
      // Vaqtni boshqa kimdir oldinroq olgan: ro'yxat yangilansin
      if (e instanceof ApiError && e.status === 409) {
        setSlot(null);
        void slots.refetch();
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (slot) book.mutate();
  };

  const pickClient = (c: Client) => {
    setPhone(c.phone);
    setName(c.full_name);
  };

  const changeSelection = (fn: () => void) => {
    fn();
    setSlot(null);
  };

  const suggestions = (clients.data ?? []).filter((c) => c.phone !== normalizePhone(phone));

  return (
    <Modal title="Yangi bron" onClose={onClose}>
      {options.isPending && <Spinner />}
      {options.error && <ErrorNote error={options.error} />}
      {options.data && services.length === 0 && <Empty>Avval xizmat qo'shing, keyin bron qilish mumkin.</Empty>}

      {services.length > 0 && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Telefon
              <input
                className={field}
                type="tel"
                required
                placeholder="90 123 45 67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Mijoz ismi
              <input
                className={field}
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>

          {suggestions.length > 0 && (
            <ul className="rounded-lg border border-line text-sm" aria-label="Topilgan mijozlar">
              {suggestions.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pickClient(c)}
                    className="flex w-full justify-between px-3 py-2 text-left hover:bg-page"
                  >
                    <span>{c.full_name}</span>
                    <span className="text-muted tabular-nums">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="block text-sm">
            Xizmat
            <select
              className={field}
              value={selectedService ?? ""}
              onChange={(e) => changeSelection(() => setServiceId(Number(e.target.value)))}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.duration_min} daqiqa · {formatMoney(s.price)}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Usta
              <select
                className={field}
                value={selectedMember ?? ""}
                onChange={(e) =>
                  changeSelection(() => setMemberId(e.target.value ? Number(e.target.value) : null))
                }
              >
                <option value="">Istalgan usta</option>
                {masters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Sana
              <input
                className={field}
                type="date"
                required
                min={todayIso()}
                value={day}
                onChange={(e) => e.target.value && changeSelection(() => setDay(e.target.value))}
              />
            </label>
          </div>

          <div className="text-sm">
            <p>Vaqt</p>
            {slots.isFetching && !slots.data && <Spinner />}
            {slots.error && <ErrorNote error={slots.error} />}
            {slots.data?.length === 0 && <Empty>Bu kunga bo'sh vaqt yo'q</Empty>}
            <div className="mt-1 grid max-h-40 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {slots.data?.map((s) => (
                <button
                  key={s.starts_at}
                  type="button"
                  aria-pressed={slot?.starts_at === s.starts_at}
                  onClick={() => setSlot(s)}
                  className={`rounded-lg border px-2 py-1.5 tabular-nums ${
                    slot?.starts_at === s.starts_at ? "border-primary bg-primary text-white" : "border-line hover:bg-page"
                  }`}
                >
                  {s.time}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm">
            Izoh
            <input className={field} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {book.error && <ErrorNote error={book.error} />}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-sm text-muted">{service ? formatMoney(service.price) : ""}</span>
            <Button type="submit" disabled={!slot || book.isPending}>
              Bron qilish
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Telefon to'liq yozilib, ism ham kiritilgan bo'lsa, qidiruv kerak emas
function slotClientUnset(phone: string, name: string) {
  return !(phone.replace(/\D/g, "").length >= 9 && name.trim().length >= 2);
}
