// Xonalar, kreslolar va apparatlar (059_resources.sql): katalog, xizmatlarga bog'lash, ustaning "o'z" kreslosi.
// Xizmatga resurs bog'lansa, shu xizmat faqat bo'sh resurs bilan bron qilinadi (usta bo'sh, kreslo band — vaqt yo'q).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Armchair, DoorOpen, Plus, Wrench, Zap, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { Membership, ReceptionOptions, Resource } from "../../api/types";
import { Modal } from "../../components/Modal";
import { Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";
import { useVocab } from "../vocab";

import { dyn, t } from "../../i18n";

const KINDS: Record<Resource["kind"], { label: string; icon: LucideIcon }> = {
  chair: { label: t("Kreslo"), icon: Armchair },
  room: { label: t("Xona / kabinet"), icon: DoorOpen },
  device: { label: t("Apparat"), icon: Zap },
};

type Draft = Omit<Resource, "id" | "upcoming"> & { id?: number };
const empty: Draft = { name: "", kind: "chair", capacity: 1, cleanup_min: 0, opens_at: null, closes_at: null, status: "active", service_ids: [], member_ids: [] };

export function ResourcesPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const v = useVocab();
  const clinic = membership.business_kind === "clinic";
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["resources", b], queryFn: () => api<Resource[]>(`/businesses/${b}/resources`) });
  const options = useQuery({ queryKey: ["reception-options", b], queryFn: () => api<ReceptionOptions>(`/businesses/${b}/reception/options`) });
  const [editing, setEditing] = useState<Draft | null>(null);
  const svcName = (id: number) => dyn(options.data?.services.find((s) => s.id === id)?.name ?? "");

  return (
    <>
      <PageTitle title={clinic ? t("Kabinetlar va kreslolar") : t("Zallar va kreslolar")}
        hint={t("Kreslo yoki xona band bo'lsa, usta bo'sh bo'lsa ham shu vaqtga bron qilinmaydi. Kalendarda \"Xonalar\" ko'rinishi ham bor.")}
        action={<Button onClick={() => setEditing({ ...empty })}><span className="inline-flex items-center gap-1"><Plus size={16} aria-hidden />{t("Qo'shish")}</span></Button>} />
      {list.isPending && <Spinner />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data?.length === 0 && (
        <Card><Empty>{t("Hali xona yoki kreslo qo'shilmagan. Masalan: \"1-kreslo\", \"Rentgen xonasi\", \"Lazer apparati\".")}</Empty></Card>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.map((r) => {
          const K = KINDS[r.kind];
          return (
            <Card key={r.id}>
              <button type="button" className="w-full text-left" onClick={() => setEditing({ ...r })}>
                <div className="flex items-start gap-3">
                  <span className={`rounded-lg p-2 ${r.status === "active" ? "bg-primary/10 text-primary" : "bg-amber-100 text-amber-700"}`}>
                    {r.status === "active" ? <K.icon size={18} aria-hidden /> : <Wrench size={18} aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted">
                      {K.label}{r.capacity > 1 && ` · ${t("{a} o'rin", { a: r.capacity })}`}
                      {r.cleanup_min > 0 && ` · ${t("tozalash {a} daq", { a: r.cleanup_min })}`}
                      {r.opens_at && ` · ${r.opens_at.slice(0, 5)}–${r.closes_at?.slice(0, 5)}`}
                      {r.status !== "active" && ` · ${t("Ta'mirda")}`}
                    </p>
                    <p className="mt-1 truncate text-xs">
                      {r.service_ids.length ? r.service_ids.map(svcName).join(", ") : <span className="text-muted">{t("Xizmat bog'lanmagan")}</span>}
                    </p>
                    <p className="text-xs text-muted">{t("Kelgusi bronlar: {a}", { a: r.upcoming })}</p>
                  </div>
                </div>
              </button>
            </Card>
          );
        })}
      </div>
      {editing && (
        <Editor businessId={b} draft={editing} options={options.data} staffWord={v.staffMany}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await queryClient.invalidateQueries({ queryKey: ["resources", b] }); await queryClient.invalidateQueries({ queryKey: ["calendar", b] }); }} />
      )}
    </>
  );
}

function Editor({ businessId, draft, options, staffWord, onClose, onSaved }: {
  businessId: number; draft: Draft; options?: ReceptionOptions; staffWord: string; onClose: () => void; onSaved: () => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [hours, setHours] = useState(!!draft.opens_at);
  const toggle = (key: "service_ids" | "member_ids", id: number) =>
    setD((x) => ({ ...x, [key]: x[key].includes(id) ? x[key].filter((y) => y !== id) : [...x[key], id] }));
  const body = () => ({
    name: d.name.trim(), kind: d.kind, capacity: d.capacity, cleanup_min: d.cleanup_min, status: d.status,
    opens_at: hours ? (d.opens_at ?? "09:00").slice(0, 5) : null, closes_at: hours ? (d.closes_at ?? "20:00").slice(0, 5) : null,
    service_ids: d.service_ids, member_ids: d.member_ids,
  });
  const save = useMutation({
    mutationFn: () => d.id ? api(`/businesses/${businessId}/resources/${d.id}`, json("PUT", body())) : api(`/businesses/${businessId}/resources`, json("POST", body())),
    onSuccess: onSaved,
  });
  const remove = useMutation({ mutationFn: () => api(`/businesses/${businessId}/resources/${d.id}`, { method: "DELETE" }), onSuccess: onSaved });

  return (
    <Modal title={d.id ? d.name : t("Yangi xona yoki kreslo")} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t("Nomi")}
            <input className={inputClass} required maxLength={80} placeholder={t("1-kreslo, VIP xona, Rentgen")} value={d.name}
              onChange={(e) => setD({ ...d, name: e.target.value })} />
          </label>
          <label className="block text-sm">{t("Turi")}
            <select className={inputClass} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Draft["kind"] })}>
              {(Object.keys(KINDS) as Draft["kind"][]).map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select>
          </label>
          <label className="block text-sm">{t("Bir vaqtda nechta mijoz")}
            <input className={inputClass} type="number" min={1} max={50} value={d.capacity} onChange={(e) => setD({ ...d, capacity: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="block text-sm">{t("Tozalash / sterilizatsiya (daqiqa)")}
            <input className={inputClass} type="number" min={0} max={120} step={5} value={d.cleanup_min} onChange={(e) => setD({ ...d, cleanup_min: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={hours} onChange={(e) => setHours(e.target.checked)} />{t("Alohida ish vaqti")}</label>
          {hours && (
            <>
              <input type="time" className="rounded border border-line px-2 py-1" value={(d.opens_at ?? "09:00").slice(0, 5)} onChange={(e) => setD({ ...d, opens_at: e.target.value })} />
              –
              <input type="time" className="rounded border border-line px-2 py-1" value={(d.closes_at ?? "20:00").slice(0, 5)} onChange={(e) => setD({ ...d, closes_at: e.target.value })} />
            </>
          )}
          <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={d.status === "maintenance"}
            onChange={(e) => setD({ ...d, status: e.target.checked ? "maintenance" : "active" })} />{t("Ta'mirda (bron qilib bo'lmaydi)")}</label>
        </div>
        <fieldset className="text-sm">
          <legend className="font-medium">{t("Qaysi xizmatlar uchun kerak")}</legend>
          <p className="mb-1 text-xs text-muted">{t("Belgilangan xizmatga bron qilinganda shu turdagi bo'sh resurs avtomatik tanlanadi.")}</p>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {options?.services.map((s) => (
              <button key={s.id} type="button" onClick={() => toggle("service_ids", s.id)}
                className={`rounded-full border px-2.5 py-1 text-xs ${d.service_ids.includes(s.id) ? "border-primary bg-primary text-white" : "border-line"}`}>{dyn(s.name)}</button>
            ))}
          </div>
        </fieldset>
        <fieldset className="text-sm">
          <legend className="font-medium">{t("Doimiy foydalanadigan {a}", { a: staffWord.toLowerCase() })}</legend>
          <p className="mb-1 text-xs text-muted">{t("Bo'sh bo'lsa, ularning broniga avval shu resurs beriladi.")}</p>
          <div className="flex flex-wrap gap-1.5">
            {options?.staff.map((m) => (
              <button key={m.id} type="button" onClick={() => toggle("member_ids", m.id)}
                className={`rounded-full border px-2.5 py-1 text-xs ${d.member_ids.includes(m.id) ? "border-primary bg-primary text-white" : "border-line"}`}>{m.full_name}</button>
            ))}
          </div>
        </fieldset>
        {(save.error || remove.error) && <ErrorNote error={save.error ?? remove.error} />}
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          {d.id && <Button type="button" variant="danger" className="mr-auto" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("O'chirish")}</Button>}
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
        </div>
      </form>
    </Modal>
  );
}
