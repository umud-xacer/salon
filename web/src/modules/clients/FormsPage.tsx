// Anketa konstruktori (direktor): muassasa o'z anketalarini quradi yoki tayyor shablondan oladi.
// Maydon "xavfli javob" bilan belgilansa — shu javob tanlanganda mijoz kartasida va kalendarda qizil belgi chiqadi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { FormField, FormFieldType, FormTemplate, Membership } from "../../api/types";
import { Modal } from "../../components/Modal";
import { Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";

import { t } from "../../i18n";

const TYPES: Record<FormFieldType, string> = {
  text: t("Qisqa matn"), textarea: t("Uzun izoh"), radio: t("Bitta tanlov"), checkbox: t("Bir nechta tanlov"),
  boolean: t("Ha / Yo'q"), date: t("Sana"), number: t("Raqam"), file: t("Rasm / fayl"),
};
const PRESETS = [
  { key: "dental", title: t("Stomatologiya bemor kartasi") },
  { key: "cosmetology", title: t("Kosmetologik protsedura oldi anketasi") },
  { key: "spa", title: t("SPA salomatlik so'rovnomasi") },
];

type Draft = { id?: number; title: string; description: string; is_active: boolean; require_signature: boolean; fields: FormField[] };
const emptyField = (): FormField => ({ label: "", type: "boolean", options: [], required: false, alert_values: [], alert_label: "" });

export function FormsPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const clinic = membership.business_kind === "clinic";
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["form-templates", b], queryFn: () => api<FormTemplate[]>(`/businesses/${b}/forms`) });
  const [editing, setEditing] = useState<Draft | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["form-templates", b] });
  const preset = useMutation({
    mutationFn: (key: string) => api<FormTemplate>(`/businesses/${b}/forms/from-preset?preset=${key}`, { method: "POST" }),
    onSuccess: refresh,
  });

  return (
    <>
      <PageTitle title={clinic ? t("Bemor kartalari") : t("Mijoz anketalari")}
        hint={t("Anketalarni mijoz kartochkasidan to'ldirasiz. Xavfli javoblar kalendarda qizil belgi bo'lib ko'rinadi.")}
        action={<Button onClick={() => setEditing({ title: "", description: "", is_active: true, require_signature: false, fields: [emptyField()] })}>
          <span className="inline-flex items-center gap-1"><Plus size={16} aria-hidden />{t("Yangi anketa")}</span>
        </Button>} />
      {list.isPending && <Spinner />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data?.length === 0 && (
        <Card>
          <Empty>{t("Hali anketa yo'q. Tayyor shablondan boshlang:")}</Empty>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => <Button key={p.key} variant="secondary" disabled={preset.isPending} onClick={() => preset.mutate(p.key)}>{p.title}</Button>)}
          </div>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {list.data?.map((x) => (
          <Card key={x.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-medium">{x.title}</h2>
                <p className="text-xs text-muted">{t("{a} ta savol · {b} marta to'ldirilgan", { a: x.fields.length, b: x.submissions })}
                  {x.require_signature && ` · ${t("imzo bilan")}`}{!x.is_active && ` · ${t("o'chirilgan")}`}</p>
              </div>
              <Button variant="secondary" onClick={() => setEditing({ ...x, description: x.description ?? "", fields: x.fields.map((f) => ({ ...f, alert_label: f.alert_label ?? "" })) })}>{t("Tahrirlash")}</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {x.fields.filter((f) => f.alert_label).map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                  <AlertOctagon size={12} aria-hidden />{f.alert_label}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
      {list.data && list.data.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          {t("Tayyor shablon qo'shish:")}
          {PRESETS.map((p) => <button key={p.key} type="button" className="text-primary hover:underline" disabled={preset.isPending} onClick={() => preset.mutate(p.key)}>{p.title}</button>)}
        </div>
      )}
      {editing && <Editor businessId={b} draft={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }} />}
    </>
  );
}

function Editor({ businessId, draft, onClose, onSaved }: { businessId: number; draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const setField = (i: number, patch: Partial<FormField>) => setD((x) => ({ ...x, fields: x.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const move = (i: number, dir: -1 | 1) => setD((x) => {
    const f = [...x.fields]; const j = i + dir;
    if (j < 0 || j >= f.length) return x;
    [f[i], f[j]] = [f[j], f[i]];
    return { ...x, fields: f };
  });
  const body = () => ({
    title: d.title.trim(), description: d.description.trim() || null, is_active: d.is_active, require_signature: d.require_signature,
    fields: d.fields.map((f) => ({ label: f.label.trim(), help: f.help?.trim() || null, type: f.type, options: f.options, required: f.required,
      alert_values: f.alert_values, alert_label: f.alert_label?.trim() || null })),
  });
  const save = useMutation({
    mutationFn: () => d.id ? api(`/businesses/${businessId}/forms/${d.id}`, json("PUT", body())) : api(`/businesses/${businessId}/forms`, json("POST", body())),
    onSuccess: onSaved,
  });
  const remove = useMutation({ mutationFn: () => api(`/businesses/${businessId}/forms/${d.id}`, { method: "DELETE" }), onSuccess: onSaved });

  return (
    <Modal title={d.id ? t("Anketani tahrirlash") : t("Yangi anketa")} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="block text-sm">{t("Nomi")}
          <input className={inputClass} required minLength={2} maxLength={120} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
        </label>
        <label className="block text-sm">{t("Tavsif (ixtiyoriy)")}
          <input className={inputClass} maxLength={1000} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
        </label>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={d.require_signature} onChange={(e) => setD({ ...d, require_signature: e.target.checked })} />{t("Mijoz imzosi majburiy")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={d.is_active} onChange={(e) => setD({ ...d, is_active: e.target.checked })} />{t("Faol")}</label>
        </div>

        <h3 className="pt-2 text-sm font-medium">{t("Savollar")}</h3>
        {d.fields.map((f, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-line p-3">
            <div className="flex gap-2">
              <input className={inputClass} required minLength={2} maxLength={300} placeholder={t("Savol matni")} value={f.label}
                onChange={(e) => setField(i, { label: e.target.value })} />
              <select className="rounded-lg border border-line px-2 text-sm" value={f.type} aria-label={t("Turi")}
                onChange={(e) => setField(i, { type: e.target.value as FormFieldType, alert_values: [], options: [] })}>
                {(Object.keys(TYPES) as FormFieldType[]).map((k) => <option key={k} value={k}>{TYPES[k]}</option>)}
              </select>
            </div>
            {(f.type === "radio" || f.type === "checkbox") && (
              <input className={inputClass} placeholder={t("Variantlar, vergul bilan: Diabet, Yurak, Yo'q")} value={f.options.join(", ")}
                onChange={(e) => setField(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean), alert_values: f.alert_values.filter((v) => e.target.value.includes(v)) })} />
            )}
            {(f.type === "boolean" || f.type === "radio" || f.type === "checkbox") && (
              <div className="rounded-md bg-red-50/60 p-2 text-sm">
                <p className="mb-1 flex items-center gap-1 text-xs text-red-700"><AlertOctagon size={12} aria-hidden />{t("Xavfli javob — kartada qizil belgi")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {f.type === "boolean" ? (
                    <label className="flex items-center gap-1"><input type="checkbox" checked={f.alert_values.includes("true")}
                      onChange={(e) => setField(i, { alert_values: e.target.checked ? ["true"] : [] })} />{t("\"Ha\" javobi")}</label>
                  ) : f.options.map((o) => (
                    <label key={o} className="flex items-center gap-1"><input type="checkbox" checked={f.alert_values.includes(o)}
                      onChange={(e) => setField(i, { alert_values: e.target.checked ? [...f.alert_values, o] : f.alert_values.filter((x) => x !== o) })} />{o}</label>
                  ))}
                  {f.alert_values.length > 0 && (
                    <input className="min-w-40 flex-1 rounded border border-line px-2 py-1" maxLength={80} placeholder={t("Belgi matni: Allergiya")}
                      value={f.alert_label ?? ""} onChange={(e) => setField(i, { alert_label: e.target.value })} />
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1"><input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} />{t("Majburiy")}</label>
              <span className="ml-auto flex gap-1">
                <button type="button" className="rounded p-1 text-muted hover:bg-page" aria-label={t("Yuqoriga")} onClick={() => move(i, -1)}><ArrowUp size={14} aria-hidden /></button>
                <button type="button" className="rounded p-1 text-muted hover:bg-page" aria-label={t("Pastga")} onClick={() => move(i, 1)}><ArrowDown size={14} aria-hidden /></button>
                <button type="button" className="rounded p-1 text-muted hover:text-danger" aria-label={t("O'chirish")} disabled={d.fields.length === 1}
                  onClick={() => setD({ ...d, fields: d.fields.filter((_, j) => j !== i) })}><Trash2 size={14} aria-hidden /></button>
              </span>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => setD({ ...d, fields: [...d.fields, emptyField()] })} disabled={d.fields.length >= 80}>
          <span className="inline-flex items-center gap-1"><Plus size={14} aria-hidden />{t("Savol qo'shish")}</span>
        </Button>
        {(save.error || remove.error) && <ErrorNote error={save.error ?? remove.error} />}
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          {d.id && <Button type="button" variant="danger" className="mr-auto" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("O'chirish")}</Button>}
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
        </div>
        {d.id && <p className="text-xs text-muted">{t("Oldin to'ldirilgan anketalar o'zgarmaydi — ularda savollar o'sha paytdagidek saqlangan.")}</p>}
      </form>
    </Modal>
  );
}
