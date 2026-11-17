// Kalendarda vaqtni bloklash (tushlik, tozalash, majlis...). Blok vaqtida ilova ham, qabulxona ham
// bron qila olmaydi — server bo'sh vaqtlarni hisoblashda uni band deb biladi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { BlockType, CalendarBlock, CalendarStaff, Membership } from "../../api/types";
import { clock, formatDate, formatTime, todayIso } from "../../components/format";
import { Button, ErrorNote, inputClass, Spinner } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { useVocab } from "../vocab";

import { dyn, t } from "../../i18n";

export interface BlockPreset {
  day: string;
  memberId?: number;
  time?: string;
}

const TZ_OFFSET = "+05:00";            // salon vaqti (Asia/Tashkent) — format.ts bilan bir xil
const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const durationLabel = (min: number) =>
  min < 60 ? t("{n} daq", { n: min }) : min % 60 ? t("{h} soat {m} daq", { h: Math.floor(min / 60), m: min % 60 })
    : t("{h} soat", { h: min / 60 });

export function BlockDialog({ membership, staff, preset, onClose }: {
  membership: Membership;
  staff: CalendarStaff[];
  preset: BlockPreset;
  onClose: () => void;
}) {
  const b = membership.business_id;
  const v = useVocab();
  const queryClient = useQueryClient();
  const types = useQuery({ queryKey: ["block-types", b], queryFn: () => api<BlockType[]>(`/businesses/${b}/block-types`) });

  // Oddiy xodim faqat o'zini bloklaydi: ro'yxatda faqat o'zi (server ham shuni tekshiradi)
  const ownOnly = !membership.permissions.includes("appointments.manage") && !membership.permissions.includes("staff.manage");
  const members = ownOnly ? staff.filter((s) => s.id === membership.member_id) : staff;

  const [memberId, setMemberId] = useState<number | null>(preset.memberId ?? members[0]?.id ?? null);
  const [day, setDay] = useState(preset.day < todayIso() ? todayIso() : preset.day);
  const [start, setStart] = useState(preset.time ?? "13:00");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [duration, setDuration] = useState(60);
  const [note, setNote] = useState("");

  const pickType = (bt: BlockType) => {
    setTypeId(bt.id);
    setDuration(bt.duration_min);
  };

  const endMinutes = Math.min(toMinutes(start) + duration, 24 * 60 - 1);
  const save = useMutation({
    mutationFn: () => api<CalendarBlock>(`/businesses/${b}/time-blocks`, json("POST", {
      member_id: memberId, type_id: typeId, note: note.trim() || null,
      starts_at: `${day}T${start}:00${TZ_OFFSET}`, ends_at: `${day}T${clock(endMinutes)}:00${TZ_OFFSET}`,
    })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["calendar", b] });
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const ready = memberId !== null && (typeId !== null || note.trim().length > 0);
  const durations = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((x, y) => x - y);

  return (
    <Modal title={t("Vaqtni bloklash")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          <span className="text-muted">{v.staffOne}</span>
          <select className={`${inputClass} mt-1`} value={memberId ?? ""} required
                  onChange={(e) => setMemberId(Number(e.target.value))}>
            {members.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </label>

        <div>
          <p className="mb-2 text-sm text-muted">{t("Turi")}</p>
          {types.isPending && <Spinner />}
          <div className="flex flex-wrap gap-2">
            {types.data?.map((bt) => (
              <button key={bt.id} type="button" onClick={() => pickType(bt)}
                      className={`rounded-full border px-3 py-1.5 text-sm ${typeId === bt.id
                        ? "border-primary bg-primary text-white" : "border-line hover:bg-page"}`}>
                {dyn(bt.name)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="text-muted">{t("Sana")}</span>
            <input type="date" className={`${inputClass} mt-1`} value={day} min={todayIso()} required
                   onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-muted">{t("Boshlanishi")}</span>
            <input type="time" step={300} className={`${inputClass} mt-1`} value={start} required
                   onChange={(e) => e.target.value && setStart(e.target.value)} />
          </label>
          <label className="col-span-2 block text-sm sm:col-span-1">
            <span className="text-muted">{t("Davomiyligi")}</span>
            <select className={`${inputClass} mt-1`} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {durations.map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted tabular-nums">{start} – {clock(endMinutes)}</p>

        <label className="block text-sm">
          <span className="text-muted">{typeId === null ? t("Izoh (tur tanlanmasa — majburiy)") : t("Izoh")}</span>
          <input className={`${inputClass} mt-1`} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {save.error && <ErrorNote error={save.error} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!ready || save.isPending}>{t("Bloklash")}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor")}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Kalendarda blok bosilganda: nima, qachon, kim uchun; blokni olib tashlash */
export function BlockInfoDialog({ membership, block, masterName, onClose }: {
  membership: Membership;
  block: CalendarBlock;
  masterName: string;
  onClose: () => void;
}) {
  const b = membership.business_id;
  const v = useVocab();
  const queryClient = useQueryClient();
  const canDelete = block.is_block && (membership.permissions.includes("appointments.manage")
    || membership.permissions.includes("staff.manage") || block.member_id === membership.member_id);
  const remove = useMutation({
    mutationFn: () => api(`/businesses/${b}/time-blocks/${block.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["calendar", b] });
      onClose();
    },
  });
  const sameDay = formatDate(block.starts_at) === formatDate(block.ends_at);

  return (
    <Modal title={block.title ? dyn(block.title) : block.is_block ? t("Blok") : t("Ta'til")} onClose={onClose}>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{v.staffOne}</dt><dd>{masterName}</dd>
        <dt className="text-muted">{t("Vaqt")}</dt>
        <dd className="tabular-nums">
          {sameDay
            ? `${formatDate(block.starts_at)}, ${formatTime(block.starts_at)}–${formatTime(block.ends_at)}`
            : `${formatDate(block.starts_at)} ${formatTime(block.starts_at)} – ${formatDate(block.ends_at)} ${formatTime(block.ends_at)}`}
        </dd>
        {block.note && <><dt className="text-muted">{t("Izoh")}</dt><dd className="break-words">{block.note}</dd></>}
      </dl>
      {!block.is_block && (
        <p className="mt-3 text-xs text-muted">{t("Ta'til Xodimlar bo'limida o'zgartiriladi.")}</p>
      )}
      {remove.error && <div className="mt-3"><ErrorNote error={remove.error} /></div>}
      {canDelete && (
        <div className="mt-5 border-t border-line pt-4">
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t("Blokni olib tashlash")}
          </Button>
        </div>
      )}
    </Modal>
  );
}
