// Mijoz kartochkasi: asosiy ma'lumot, ogohlantirish va allergiya, teglar, eslatmalar tarixi, bronlar.
// Ogohlantirish va allergiya kalendardagi bronda ham ko'rinadi (ustaga ham) — mijozning o'ziga ko'rinmaydi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

import { api, json } from "../../api/client";
import type { ClientGender, ClientNote, ClientRecord, ClientSource } from "../../api/types";
import { formatDate, formatTime, normalizePhone, todayIso } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Button, ErrorNote, inputClass, Spinner } from "../../components/ui";
import { useVocab } from "../vocab";
import { ClientRecords, MedicalAlerts } from "./ClientMedical";

import { localized, t } from "../../i18n";

export const SOURCE_LABELS: Record<ClientSource, string> = localized({
  instagram: "Instagram",
  telegram: "Telegram",
  recommendation: "Tanishlar tavsiyasi",
  walk_by: "O'tib ketayotib ko'rgan",
  google: "Google / Yandex xarita",
  chronix: "Chronix ilovasi",
  advert: "Reklama",
  other: "Boshqa",
});
const GENDER_LABELS: Record<ClientGender, string> = localized({ female: "Ayol", male: "Erkak" });

export function ClientDialog({ businessId, client, onClose }: {
  businessId: number;
  client: ClientRecord | null;
  onClose: () => void;
}) {
  const v = useVocab();
  const queryClient = useQueryClient();
  const url = `/businesses/${businessId}/clients`;
  const [name, setName] = useState(client?.full_name ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [birthDate, setBirthDate] = useState(client?.birth_date ?? "");
  const [gender, setGender] = useState<ClientGender | "">(client?.gender ?? "");
  const [source, setSource] = useState<ClientSource | "">(client?.source ?? "");
  const [tags, setTags] = useState<string[]>(client?.tags ?? []);
  const [alert, setAlert] = useState(client?.alert ?? "");
  const [allergies, setAllergies] = useState(client?.allergies ?? "");
  const [firstNote, setFirstNote] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        full_name: name.trim(), birth_date: birthDate || null, gender: gender || null, source: source || null,
        tags, alert: alert.trim() || null, allergies: allergies.trim() || null,
      };
      if (!client?.has_account) body.phone = normalizePhone(phone);
      if (!client && firstNote.trim()) body.notes = firstNote.trim();
      return client ? api(`${url}/${client.id}`, json("PATCH", body)) : api(url, json("POST", body));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client-list", businessId] });
      await queryClient.invalidateQueries({ queryKey: ["client-tags", businessId] });
      await queryClient.invalidateQueries({ queryKey: ["calendar", businessId] });
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal title={client ? client.full_name : t("Yangi {a}", { a: v.clientOne.toLowerCase() })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <MedicalAlerts alerts={client?.medical_alerts} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t("Ism familiya")}
            <input className={inputClass} required minLength={2} maxLength={120} value={name}
              onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Telefon")}
            <input className={inputClass} type="tel" required disabled={client?.has_account} value={phone}
              onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        {client?.has_account && (
          <p className="text-xs text-muted">{t("{a} ilovadan foydalanadi, telefonini faqat o'zi o'zgartiradi.", { a: v.clientOne })}</p>
        )}
        {client?.backup_phone && (
          <p className="text-sm">{t("Zaxira raqam")}:{" "}
            <a className="text-primary" href={`tel:${client.backup_phone}`}>{client.backup_phone}</a></p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">{t("Tug'ilgan sana")}
            <input className={inputClass} type="date" min="1900-01-01" max={todayIso()} value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Jinsi")}
            <select className={inputClass} value={gender} onChange={(e) => setGender(e.target.value as ClientGender | "")}>
              <option value="">—</option>
              {(Object.keys(GENDER_LABELS) as ClientGender[]).map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
            </select>
          </label>
          <label className="block text-sm">{t("Qayerdan keldi")}
            <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value as ClientSource | "")}>
              <option value="">—</option>
              {(Object.keys(SOURCE_LABELS) as ClientSource[]).map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
            </select>
          </label>
        </div>

        <TagsInput businessId={businessId} value={tags} onChange={setTags} />

        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="flex items-center gap-1.5 text-xs text-amber-800">
            <AlertTriangle size={14} aria-hidden />
            {t("Jamoa uchun: bronda {a}ga ham ko'rinadi, {b}ning o'ziga ko'rinmaydi", { a: v.staffOne.toLowerCase(), b: v.clientOne.toLowerCase() })}
          </p>
          <label className="block text-sm">{t("Allergiya")}
            <input className={inputClass} maxLength={500} placeholder={t("Masalan: ammiakli bo'yoq, lateks")}
              value={allergies} onChange={(e) => setAllergies(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Ogohlantirish")}
            <input className={inputClass} maxLength={300} placeholder={t("Masalan: ko'p kechikadi, oldindan qo'ng'iroq qiling")}
              value={alert} onChange={(e) => setAlert(e.target.value)} />
          </label>
        </div>

        {!client && (
          <label className="block text-sm">{t("Eslatma")}
            <textarea className={inputClass} rows={2} maxLength={2000} placeholder={t("Afzalliklar, kelishuvlar")}
              value={firstNote} onChange={(e) => setFirstNote(e.target.value)} />
          </label>
        )}
        {save.error && <ErrorNote error={save.error} />}
        <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
      </form>

      {client && <NotesSection businessId={businessId} clientId={client.id} />}

      {client && <ClientRecords businessId={businessId} clientId={client.id} clientName={client.full_name} />}
    </Modal>
  );
}

/** Teglar: Enter yoki vergul bilan qo'shiladi; muassasada ishlatilganlari tavsiya qilinadi */
function TagsInput({ businessId, value, onChange }: { businessId: number; value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const known = useQuery({
    queryKey: ["client-tags", businessId],
    queryFn: () => api<{ tag: string; count: number }[]>(`/businesses/${businessId}/clients/tags`),
  });
  const has = (tag: string) => value.some((x) => x.toLowerCase() === tag.toLowerCase());
  const add = (raw: string) => {
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, 30);
    if (tag && !has(tag) && value.length < 10) onChange([...value, tag]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const suggestions = (known.data ?? []).map((k) => k.tag).filter((tag) => !has(tag)
    && (!draft || tag.toLowerCase().includes(draft.toLowerCase()))).slice(0, 8);

  return (
    <div className="text-sm">
      <span>{t("Teglar")}</span>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-line px-2 py-1.5 focus-within:border-primary">
        {value.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {tag}
            <button type="button" aria-label={t("O'chirish")} onClick={() => onChange(value.filter((x) => x !== tag))}>
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        {value.length < 10 && (
          <input className="min-w-28 flex-1 bg-transparent py-0.5 outline-none" maxLength={30} value={draft}
                 placeholder={value.length ? "" : t("VIP, doimiy, talaba... (Enter)")}
                 onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft && add(draft)} />
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((tag) => (
            <button key={tag} type="button" onClick={() => add(tag)}
                    className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:bg-page">
              + {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotesSection({ businessId, clientId }: { businessId: number; clientId: number }) {
  const queryClient = useQueryClient();
  const url = `/businesses/${businessId}/clients/${clientId}/notes`;
  const key = ["client-notes", businessId, clientId];
  const notes = useQuery({ queryKey: key, queryFn: () => api<ClientNote[]>(url) });
  const [body, setBody] = useState("");
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: ["client-list", businessId] });
  };
  const add = useMutation({
    mutationFn: () => api<ClientNote>(url, json("POST", { body: body.trim() })),
    onSuccess: async () => { setBody(""); await refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`${url}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-sm font-medium">{t("Eslatmalar")}</h3>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
        <textarea className={inputClass} rows={2} maxLength={2000} value={body} placeholder={t("Yangi eslatma")}
                  onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" className="self-end" disabled={add.isPending || !body.trim()}>{t("Qo'shish")}</Button>
      </form>
      {(add.error || remove.error) && <div className="mt-2"><ErrorNote error={add.error ?? remove.error} /></div>}
      {notes.isPending && <Spinner />}
      <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto">
        {notes.data?.map((n) => (
          <li key={n.id} className="rounded-lg bg-page px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="whitespace-pre-wrap break-words">{n.body}</p>
              {n.can_delete && (
                <button type="button" className="shrink-0 rounded p-1 text-muted hover:text-danger" aria-label={t("O'chirish")}
                        disabled={remove.isPending} onClick={() => remove.mutate(n.id)}>
                  <Trash2 size={14} aria-hidden />
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              {formatDate(n.created_at)} {formatTime(n.created_at)}{n.author ? ` · ${n.author}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
