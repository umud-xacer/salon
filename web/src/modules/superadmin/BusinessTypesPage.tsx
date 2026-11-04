// Super Admin: muassasa turlari (go'zallik saloni, dorixona, klinika...). Har bir tur uchun
// mijoz ilovasidagi bo'lim, standart ish vaqti va direktorga taklif qilinadigan xizmatlar.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { BusinessType, ServicePreset } from "../../api/types";
import { formatMoney } from "../../components/format";
import { Modal } from "../../components/Modal";
import { KIND_LABELS, type BusinessKind } from "../vocab";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";

export const TYPES_KEY = ["superadmin", "business-types"];

export function useBusinessTypes() {
  return useQuery({ queryKey: TYPES_KEY, queryFn: () => api<BusinessType[]>("/superadmin/business-types") });
}

export function BusinessTypesPage() {
  const types = useBusinessTypes();
  const [editing, setEditing] = useState<BusinessType | "new" | null>(null);

  return (
    <>
      <PageTitle
        title="Muassasa turlari"
        hint="Ilovadagi bo'limlar, standart ish vaqti va tavsiya xizmatlar"
        action={
          <Button className="flex items-center gap-1" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden /> Yangi tur
          </Button>
        }
      />
      {types.isPending && <Spinner />}
      {types.error && <ErrorNote error={types.error} />}
      {types.data?.length === 0 && <Card><Empty>Turlar yo'q</Empty></Card>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {types.data?.map((t) => (
          <li key={t.id}>
            <button onClick={() => setEditing(t)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page">
              <span className="min-w-0 basis-full font-medium sm:basis-auto sm:flex-1">
                {t.name_uz} <span className="text-xs font-normal text-muted">({t.slug})</span>
              </span>
              {!t.is_active && <Badge tone="gray">O'chirilgan</Badge>}
              <span className="text-muted tabular-nums">{t.opens_at.slice(0, 5)}–{t.closes_at.slice(0, 5)}</span>
              <span className="text-muted">{t.service_presets.length} ta xizmat</span>
              <span className="tabular-nums sm:w-24 sm:text-right">{t.business_count} ta salon</span>
            </button>
          </li>
        ))}
      </ul>
      {editing && <TypeDialog type={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const emptyPreset = (): ServicePreset => ({ name: "", duration_min: 30, price: 0 });

function TypeDialog({ type, onClose }: { type: BusinessType | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState(type?.slug ?? "");
  const [nameUz, setNameUz] = useState(type?.name_uz ?? "");
  const [kind, setKind] = useState<string>(type?.kind ?? "salon");
  const [nameRu, setNameRu] = useState(type?.name_ru ?? "");
  const [icon, setIcon] = useState(type?.icon ?? "");
  const [order, setOrder] = useState(String(type?.sort_order ?? 10));
  const [active, setActive] = useState(type?.is_active ?? true);
  const [opens, setOpens] = useState(type?.opens_at.slice(0, 5) ?? "09:00");
  const [closes, setCloses] = useState(type?.closes_at.slice(0, 5) ?? "20:00");
  const [presets, setPresets] = useState<ServicePreset[]>(type?.service_presets ?? []);

  const setPreset = (i: number, patch: Partial<ServicePreset>) =>
    setPresets(presets.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const badHours = closes <= opens;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind, name_uz: nameUz.trim(), name_ru: nameRu.trim(), icon: icon.trim() || null, sort_order: Number(order) || 0,
        is_active: active, opens_at: opens, closes_at: closes,
        service_presets: presets.filter((p) => p.name.trim()).map((p) => ({ ...p, name: p.name.trim() })),
      };
      return type
        ? api(`/superadmin/business-types/${type.id}`, json("PATCH", body))
        : api("/superadmin/business-types", json("POST", { ...body, slug: slug.trim() }));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TYPES_KEY });
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal title={type ? type.name_uz : "Yangi muassasa turi"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Ish tartibi (panel va ilova shunga moslashadi)
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            {(Object.keys(KIND_LABELS) as BusinessKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Nomi (o'zbekcha)
            <input className={inputClass} required minLength={2} maxLength={80} value={nameUz} data-autofocus
              onChange={(e) => setNameUz(e.target.value)} />
          </label>
          <label className="block text-sm">Nomi (ruscha)
            <input className={inputClass} required minLength={2} maxLength={80} value={nameRu}
              onChange={(e) => setNameRu(e.target.value)} />
          </label>
          <label className="block text-sm">Kod (lotin, keyin o'zgarmaydi)
            <input className={inputClass} required pattern="[a-z0-9]+(_[a-z0-9]+)*" maxLength={40} value={slug}
              disabled={!!type} placeholder="masalan: vet_clinic" onChange={(e) => setSlug(e.target.value)} />
          </label>
          <label className="block text-sm">Tartib raqami (ilovada)
            <input className={inputClass} type="number" min={0} max={1000} value={order}
              onChange={(e) => setOrder(e.target.value)} />
          </label>
          <label className="block text-sm">Standart ochilish
            <input className={inputClass} type="time" required value={opens} onChange={(e) => setOpens(e.target.value)} />
          </label>
          <label className="block text-sm">Standart yopilish
            <input className={inputClass} type="time" required value={closes} onChange={(e) => setCloses(e.target.value)} />
          </label>
          <label className="block text-sm">Belgi (ixtiyoriy)
            <input className={inputClass} pattern="[a-z0-9-]+" maxLength={40} value={icon} placeholder="pill"
              onChange={(e) => setIcon(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={active}
              onChange={(e) => setActive(e.target.checked)} />
            Ilovada ko'rinsin
          </label>
        </div>
        {badHours && <p className="text-sm text-danger">Yopilish vaqti ochilishdan keyin bo'lishi kerak</p>}
        {!active && type && type.business_count > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            O'chirilsa, shu turdagi {type.business_count} ta salon mijoz ilovasida ko'rinmaydi.
          </p>
        )}

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Tavsiya xizmatlar</legend>
          <p className="mb-2 text-xs text-muted">
            Direktor "Xizmatlar" bo'limida bir bosishda qo'shadi. Narx va davomiylikni keyin o'zi o'zgartiradi.
          </p>
          <ul className="space-y-2">
            {presets.map((p, i) => (
              <li key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_6rem_8rem_auto]">
                <input className={`${inputClass} mt-0 col-span-2 sm:col-span-1`} aria-label="Xizmat nomi"
                  placeholder="Xizmat nomi" maxLength={120} value={p.name} onChange={(e) => setPreset(i, { name: e.target.value })} />
                <input className={`${inputClass} mt-0`} aria-label="Davomiyligi, daqiqa" type="number" min={5} max={720}
                  value={p.duration_min} onChange={(e) => setPreset(i, { duration_min: Number(e.target.value) })} />
                <input className={`${inputClass} mt-0`} aria-label="Narxi, so'm" type="number" min={0} step={1000}
                  value={p.price} onChange={(e) => setPreset(i, { price: Number(e.target.value) })} />
                <button type="button" aria-label="Xizmatni olib tashlash" className="px-2 text-danger"
                  onClick={() => setPresets(presets.filter((_, k) => k !== i))}>
                  <Trash2 size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {presets.length > 0 && (
            <p className="mt-1 text-xs text-muted">Daqiqa · so'm. Masalan: {presets[0].duration_min} daqiqa, {formatMoney(presets[0].price)}</p>
          )}
          <Button type="button" variant="secondary" className="mt-2 flex items-center gap-1" disabled={presets.length >= 50}
            onClick={() => setPresets([...presets, emptyPreset()])}>
            <Plus size={15} aria-hidden /> Xizmat qo'shish
          </Button>
        </fieldset>

        {save.error && <ErrorNote error={save.error} />}
        <Button type="submit" disabled={save.isPending || badHours} className="w-full">Saqlash</Button>
      </form>
    </Modal>
  );
}
