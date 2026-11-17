// Mijoz/bemor kartasi: tibbiy ogohlantirishlar, anketalar (to'ldirish, imzo, chop etish), fayllar va tashriflar tarixi.
// Tibbiy rasmlar ochiq havolada emas: token bilan olinadi (apiBlobUrl) va brauzer keshida qolmaydi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, CalendarCheck, ClipboardList, FileImage, Printer, StickyNote, Trash2, Upload } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type MutableRefObject } from "react";

import { api, apiBlobUrl, json } from "../../api/client";
import type { ClientFile, FormSubmission, FormTemplate, TimelineItem } from "../../api/types";
import { formatDate, formatMoney, formatTime, STATUS_LABELS } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Button, Empty, ErrorNote, inputClass, Spinner } from "../../components/ui";

import { t } from "../../i18n";

/** Qizil ogohlantirish belgilari (kartochka tepasida, bron oynasida) */
export function MedicalAlerts({ alerts, compact }: { alerts?: string[] | null; compact?: boolean }) {
  if (!alerts?.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "" : "rounded-lg border border-red-200 bg-red-50 p-2"}`}>
      {!compact && <AlertOctagon size={16} className="text-red-600" aria-hidden />}
      {alerts.map((a) => (
        <span key={a} className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">{a}</span>
      ))}
    </div>
  );
}

/** Himoyalangan rasm: token bilan olinadi */
function SecureImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    apiBlobUrl(path).then((u) => { url = u; if (alive) setSrc(u); else URL.revokeObjectURL(u); }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [path]);
  return src ? <img src={src} alt={alt} className={className} /> : <div className={`animate-pulse bg-page ${className ?? ""}`} />;
}

const answerText = (f: FormSubmission["fields"][number], v: unknown): string => {
  if (v === undefined || v === null || v === "") return "—";
  if (f.type === "boolean") return v === "true" ? t("Ha") : t("Yo'q");
  if (Array.isArray(v)) return f.type === "file" ? t("{a} ta fayl", { a: v.length }) : v.join(", ");
  return String(v);
};

export function ClientRecords({ businessId, clientId, clientName }: { businessId: number; clientId: number; clientName: string }) {
  const base = `/businesses/${businessId}/clients/${clientId}`;
  const [tab, setTab] = useState<"timeline" | "forms" | "files">("timeline");
  const [filling, setFilling] = useState<FormTemplate | null>(null);
  const [viewing, setViewing] = useState<FormSubmission | null>(null);
  const templates = useQuery({ queryKey: ["form-templates", businessId], queryFn: () => api<FormTemplate[]>(`/businesses/${businessId}/forms`) });
  const subs = useQuery({ queryKey: ["client-forms", businessId, clientId], queryFn: () => api<FormSubmission[]>(`${base}/forms`) });
  const active = (templates.data ?? []).filter((x) => x.is_active);

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "timeline", label: t("Tarix") }, { id: "forms", label: t("Anketalar") }, { id: "files", label: t("Rasmlar") },
  ];
  return (
    <section className="mt-5 border-t border-line pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tabs.map((x) => (
          <button key={x.id} type="button" onClick={() => setTab(x.id)}
            className={`rounded-full px-3 py-1 text-sm ${tab === x.id ? "bg-navy text-white" : "bg-page text-ink hover:bg-line"}`}>
            {x.label}
          </button>
        ))}
        {active.length > 0 && (
          <select className="ml-auto rounded-lg border border-line bg-white px-2 py-1 text-sm" value=""
            aria-label={t("Anketa to'ldirish")}
            onChange={(e) => setFilling(active.find((x) => x.id === Number(e.target.value)) ?? null)}>
            <option value="">+ {t("Anketa to'ldirish")}</option>
            {active.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        )}
      </div>

      {tab === "timeline" && <Timeline base={base} />}
      {tab === "forms" && (
        <>
          {subs.isPending && <Spinner />}
          {subs.data?.length === 0 && <Empty>{t("Hali anketa to'ldirilmagan")}</Empty>}
          <ul className="divide-y divide-line text-sm">
            {subs.data?.map((s) => (
              <li key={s.id}>
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left hover:bg-page"
                  onClick={() => setViewing(s)}>
                  <span className="font-medium">{s.title}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <MedicalAlerts alerts={s.alerts} compact />
                    {s.signed_at && <span className="text-emerald-700">✓ {t("Imzolangan")}</span>}
                    {formatDate(s.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === "files" && <Files base={base} />}

      {filling && (
        <FillForm base={base} businessId={businessId} clientId={clientId} template={filling} onClose={() => setFilling(null)}
          onDone={(s) => { setFilling(null); setViewing(s); setTab("forms"); }} />
      )}
      {viewing && <SubmissionView base={base} submission={viewing} clientName={clientName} onClose={() => setViewing(null)} />}
    </section>
  );
}

function Timeline({ base }: { base: string }) {
  const q = useQuery({ queryKey: ["client-timeline", base], queryFn: () => api<TimelineItem[]>(`${base}/timeline`) });
  const icon = { visit: CalendarCheck, form: ClipboardList, note: StickyNote, file: FileImage };
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data?.length) return <Empty>{t("Tarix bo'sh")}</Empty>;
  return (
    <ol className="max-h-80 space-y-3 overflow-y-auto border-l border-line pl-4">
      {q.data.map((x) => {
        const Icon = icon[x.kind];
        return (
          <li key={`${x.kind}${x.id}`} className="relative text-sm">
            <span className="absolute -left-[25px] top-0.5 rounded-full bg-white p-0.5 text-primary"><Icon size={14} aria-hidden /></span>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{x.title}</span>
              <span className="text-xs text-muted">{formatDate(x.at)} {formatTime(x.at)}</span>
            </div>
            <p className="text-xs text-muted">
              {[x.member_name, x.status && (STATUS_LABELS[x.status] ?? x.status), x.amount ? formatMoney(x.amount) : null].filter(Boolean).join(" · ")}
            </p>
            {x.detail && <p className="whitespace-pre-wrap break-words text-xs">{x.detail}</p>}
            <MedicalAlerts alerts={x.alerts} compact />
          </li>
        );
      })}
    </ol>
  );
}

function Files({ base }: { base: string }) {
  const queryClient = useQueryClient();
  const key = ["client-files", base];
  const q = useQuery({ queryKey: key, queryFn: () => api<ClientFile[]>(`${base}/files`) });
  const [caption, setCaption] = useState("");
  const [open, setOpen] = useState<ClientFile | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      if (caption.trim()) form.append("caption", caption.trim());
      return api<ClientFile>(`${base}/files`, { method: "POST", body: form });
    },
    onSuccess: async () => { setCaption(""); await queryClient.invalidateQueries({ queryKey: key }); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`${base}/files/${id}`, { method: "DELETE" }),
    onSuccess: async () => { setOpen(null); await queryClient.invalidateQueries({ queryKey: key }); },
  });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block flex-1 text-sm">{t("Izoh (ixtiyoriy)")}
          <input className={inputClass} maxLength={200} placeholder={t("Masalan: rentgen, \"oldin\" surati")} value={caption}
            onChange={(e) => setCaption(e.target.value)} />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-page">
          <Upload size={16} aria-hidden />{upload.isPending ? t("Yuklanmoqda…") : t("Rasm yuklash")}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={upload.isPending}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
        </label>
      </div>
      {upload.error && <ErrorNote error={upload.error} />}
      {q.data?.length === 0 && <Empty>{t("Rasm yo'q")}</Empty>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {q.data?.map((f) => (
          <button key={f.id} type="button" onClick={() => setOpen(f)} className="text-left">
            <SecureImage path={`${base}/files/${f.id}`} alt={f.caption ?? ""} className="aspect-square w-full rounded-lg object-cover" />
            <p className="mt-1 truncate text-xs text-muted">{f.caption ?? formatDate(f.created_at)}</p>
          </button>
        ))}
      </div>
      {open && (
        <Modal title={open.caption ?? t("Rasm")} onClose={() => setOpen(null)}>
          <SecureImage path={`${base}/files/${open.id}`} alt={open.caption ?? ""} className="max-h-[70vh] w-full rounded-lg object-contain" />
          <p className="mt-2 text-xs text-muted">{formatDate(open.created_at)} {formatTime(open.created_at)} · {open.created_by_name ?? ""}</p>
          <div className="mt-3 flex justify-end">
            <Button variant="danger" onClick={() => remove.mutate(open.id)} disabled={remove.isPending}>
              <span className="inline-flex items-center gap-1"><Trash2 size={14} aria-hidden />{t("O'chirish")}</span>
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function FillForm({ base, businessId, clientId, template, onClose, onDone }: {
  base: string; businessId: number; clientId: number; template: FormTemplate; onClose: () => void; onDone: (s: FormSubmission) => void;
}) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [uploading, setUploading] = useState<number | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);
  const set = (id: number, v: unknown) => setAnswers((a) => ({ ...a, [String(id)]: v }));

  const save = useMutation({
    mutationFn: async () => {
      let s = await api<FormSubmission>(`${base}/forms`, json("POST", { template_id: template.id, answers }));
      const png = sigRef.current?.toBlob ? await sigRef.current.toBlob() : null;
      if (png) {
        const form = new FormData();
        form.append("file", png, "signature.png");
        s = await api<FormSubmission>(`${base}/forms/${s.id}/signature`, { method: "POST", body: form });
      }
      return s;
    },
    onSuccess: async (s) => {
      await Promise.all(["client-forms", "client-timeline", "client-list", "calendar"].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] })));
      await queryClient.invalidateQueries({ queryKey: ["client-forms", businessId, clientId] });
      onDone(s);
    },
  });
  const uploadFor = async (fieldId: number, file: File) => {
    setUploading(fieldId);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", template.fields.find((f) => f.id === fieldId)?.label ?? "");
      const f = await api<ClientFile>(`${base}/files`, { method: "POST", body: form });
      const cur = (answers[String(fieldId)] as number[] | undefined) ?? [];
      set(fieldId, [...cur, f.id]);
    } finally {
      setUploading(null);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (template.require_signature && sigRef.current?.isEmpty()) return;
    save.mutate();
  };

  return (
    <Modal title={template.title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {template.description && <p className="text-sm text-muted">{template.description}</p>}
        {template.fields.map((f) => {
          const v = answers[String(f.id)];
          const label = <span className="text-sm font-medium">{f.label}{f.required && <span className="text-danger"> *</span>}</span>;
          return (
            <div key={f.id} className="space-y-1">
              {f.type !== "boolean" && label}
              {f.help && <p className="text-xs text-muted">{f.help}</p>}
              {f.type === "text" && <input className={inputClass} maxLength={500} required={f.required} value={(v as string) ?? ""} onChange={(e) => set(f.id, e.target.value)} />}
              {f.type === "textarea" && <textarea className={inputClass} rows={3} maxLength={5000} required={f.required} value={(v as string) ?? ""} onChange={(e) => set(f.id, e.target.value)} />}
              {f.type === "number" && <input className={inputClass} type="number" required={f.required} value={(v as number) ?? ""} onChange={(e) => set(f.id, e.target.value === "" ? null : Number(e.target.value))} />}
              {f.type === "date" && <input className={inputClass} type="date" required={f.required} value={(v as string) ?? ""} onChange={(e) => set(f.id, e.target.value)} />}
              {f.type === "boolean" && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {label}
                  <div className="flex gap-1">
                    {[true, false].map((b) => (
                      <button key={String(b)} type="button" onClick={() => set(f.id, b)}
                        className={`rounded-lg border px-4 py-1.5 text-sm ${v === b ? (b && f.alert_values.includes("true") ? "border-red-600 bg-red-600 text-white" : "border-navy bg-navy text-white") : "border-line"}`}>
                        {b ? t("Ha") : t("Yo'q")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {f.type === "radio" && (
                <div className="flex flex-wrap gap-2">
                  {f.options.map((o) => (
                    <label key={o} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${v === o ? "border-navy bg-navy text-white" : "border-line"}`}>
                      <input type="radio" className="hidden" name={`f${f.id}`} checked={v === o} onChange={() => set(f.id, o)} />{o}
                    </label>
                  ))}
                </div>
              )}
              {f.type === "checkbox" && (
                <div className="flex flex-wrap gap-2">
                  {f.options.map((o) => {
                    const list = (v as string[]) ?? [];
                    const on = list.includes(o);
                    return (
                      <label key={o} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${on ? "border-navy bg-navy text-white" : "border-line"}`}>
                        <input type="checkbox" className="hidden" checked={on} onChange={() => set(f.id, on ? list.filter((x) => x !== o) : [...list, o])} />{o}
                      </label>
                    );
                  })}
                </div>
              )}
              {f.type === "file" && (
                <div className="flex flex-wrap items-center gap-2">
                  {((v as number[]) ?? []).map((id) => (
                    <SecureImage key={id} path={`${base}/files/${id}`} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  ))}
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-line px-3 py-2 text-sm hover:bg-page">
                    <Upload size={14} aria-hidden />{uploading === f.id ? t("Yuklanmoqda…") : t("Rasm qo'shish")}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading !== null}
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadFor(f.id, file); e.target.value = ""; }} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
        <div className="space-y-1">
          <span className="text-sm font-medium">{t("Mijoz imzosi")}{template.require_signature && <span className="text-danger"> *</span>}</span>
          <p className="text-xs text-muted">{t("Ma'lumotlar to'g'riligini va muolajaga roziligini tasdiqlab, barmoq yoki sichqoncha bilan imzo qo'yadi.")}</p>
          <SignaturePad ref={sigRef} />
        </div>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button type="submit" disabled={save.isPending || uploading !== null}>{t("Saqlash")}</Button>
        </div>
      </form>
    </Modal>
  );
}

type SignaturePadHandle = { isEmpty: () => boolean; toBlob: () => Promise<Blob | null> };

function SignaturePadInner({ handle }: { handle: MutableRefObject<SignaturePadHandle | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    handle.current = {
      isEmpty: () => empty,
      toBlob: () => new Promise((res) => (empty || !canvas.current ? res(null) : canvas.current.toBlob((b) => res(b), "image/png"))),
    };
  }, [empty, handle]);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * e.currentTarget.width, ((e.clientY - r.top) / r.height) * e.currentTarget.height];
  };
  return (
    <div>
      <canvas ref={canvas} width={600} height={180} className="h-36 w-full touch-none rounded-lg border border-dashed border-line bg-white"
        onPointerDown={(e) => {
          const ctx = e.currentTarget.getContext("2d")!;
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const [x, y] = pos(e);
          ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#0a1650";
          ctx.beginPath(); ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const [x, y] = pos(e);
          ctx.lineTo(x, y); ctx.stroke();
          setEmpty(false);
        }}
        onPointerUp={() => { drawing.current = false; }} />
      <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => {
        const c = canvas.current; if (!c) return;
        c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setEmpty(true);
      }}>{t("Tozalash")}</button>
    </div>
  );
}

const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_, ref) {
  const inner = useRef<SignaturePadHandle | null>(null);
  useImperativeHandle(ref, () => ({
    isEmpty: () => inner.current?.isEmpty() ?? true,
    toBlob: () => inner.current?.toBlob() ?? Promise.resolve(null),
  }));
  return <SignaturePadInner handle={inner} />;
});

function SubmissionView({ base, submission: s, clientName, onClose }: {
  base: string; submission: FormSubmission; clientName: string; onClose: () => void;
}) {
  const print = () => {
    const el = document.getElementById(`submission-${s.id}`);
    if (!el) return;
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${s.title}</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:20px}dt{font-weight:600;margin-top:10px}
      dd{margin:2px 0 0}.alert{display:inline-block;background:#dc2626;color:#fff;border-radius:999px;padding:2px 8px;font-size:12px;margin:2px}
      img{max-width:300px}</style></head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    w.onload = () => { w.print(); };
  };
  return (
    <Modal title={s.title} onClose={onClose}>
      <div id={`submission-${s.id}`}>
        <h1 className="sr-only">{s.title}</h1>
        <p className="text-sm">{clientName} · {formatDate(s.created_at)} {formatTime(s.created_at)}{s.filled_by_name ? ` · ${s.filled_by_name}` : ""}</p>
        {s.alerts.length > 0 && <div className="my-2">{s.alerts.map((a) => <span key={a} className="alert mr-1 inline-block rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">{a}</span>)}</div>}
        <dl className="mt-3 space-y-2 text-sm">
          {s.fields.map((f) => {
            const v = s.answers[String(f.id)];
            return (
              <div key={f.id}>
                <dt className="font-medium">{f.label}</dt>
                <dd className="text-muted">
                  {f.type === "file" && Array.isArray(v)
                    ? <span className="flex flex-wrap gap-2">{(v as number[]).map((id) => <SecureImage key={id} path={`${base}/files/${id}`} alt="" className="h-24 w-24 rounded object-cover" />)}</span>
                    : answerText(f, v)}
                </dd>
              </div>
            );
          })}
        </dl>
        {s.signature_file && (
          <div className="mt-4">
            <p className="text-xs text-muted">{t("Imzo")} · {s.signed_at && `${formatDate(s.signed_at)} ${formatTime(s.signed_at)}`}</p>
            <SecureImage path={`${base}/files/${s.signature_file}`} alt={t("Imzo")} className="h-24 rounded border border-line bg-white" />
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={print}><span className="inline-flex items-center gap-1"><Printer size={14} aria-hidden />{t("Chop etish / PDF")}</span></Button>
        <Button onClick={onClose}>{t("Yopish")}</Button>
      </div>
    </Modal>
  );
}
