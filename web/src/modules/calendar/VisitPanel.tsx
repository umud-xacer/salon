// Tashrif xizmatlari: bitta tashrifga bir nechta xizmat, har biri o'z ijrochisi bilan (ko'rik — shifokor,
// tahlil — laborant yoki muassasa hisobiga). Narx va jami summani server hisoblaydi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt as ReceiptIcon, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { Membership, ReceptionOptions, VisitLines } from "../../api/types";
import { formatMoney } from "../../components/format";
import { Button, ErrorNote, inputClass, Spinner } from "../../components/ui";
import { pick, t } from "../../i18n";
import { useVocab } from "../vocab";
import { ReceiptDialog } from "./ReceiptDialog";

const HOUSE = "house";
const CLOSED = ["cancelled", "no_show"];

export function VisitPanel({ membership, appointmentId }: { membership: Membership; appointmentId: number }) {
  const b = membership.business_id;
  const v = useVocab();
  const queryClient = useQueryClient();
  const url = `/businesses/${b}/appointments/${appointmentId}/lines`;
  const canManage = membership.permissions.includes("appointments.manage");
  const [adding, setAdding] = useState(false);
  const [receipt, setReceipt] = useState(false);

  const query = useQuery({ queryKey: ["visit-lines", b, appointmentId], queryFn: () => api<VisitLines>(url) });
  const refresh = async (data: VisitLines) => {
    queryClient.setQueryData(["visit-lines", b, appointmentId], data);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["payments", b, appointmentId] }),
      queryClient.invalidateQueries({ queryKey: ["calendar", b] }),
      queryClient.invalidateQueries({ queryKey: ["cash-day", b] }),
    ]);
  };
  const remove = useMutation({
    mutationFn: (lineId: number) => api<VisitLines>(`${url}/${lineId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  if (query.isPending) return <Spinner />;
  if (query.error) return <div className="mt-3"><ErrorNote error={query.error} /></div>;
  const data = query.data;
  const editable = canManage && !CLOSED.includes(data.status);

  return (
    <section className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{v.services}</h3>
        <Button variant="secondary" className="flex items-center gap-1 !px-2 !py-1 text-xs" onClick={() => setReceipt(true)}>
          <ReceiptIcon size={14} aria-hidden /> {t("Chek")}
        </Button>
      </div>
      <ul className="mt-2 divide-y divide-line text-sm">
        {data.lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block break-words">{pick(l.service_name, l.service_name_ru)}</span>
              <span className="block text-xs text-muted">
                {l.house ? t("Muassasa hisobiga") : l.member_name}
                {l.category_name && ` · ${pick(l.category_name, l.category_name_ru)}`}
              </span>
            </span>
            <span className="tabular-nums">{formatMoney(l.price)}</span>
            {editable && data.lines.length > 1 && (
              <button type="button" aria-label={t("Olib tashlash")} disabled={remove.isPending}
                onClick={() => remove.mutate(l.id)} className="text-muted hover:text-danger disabled:opacity-50">
                <Trash2 size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="flex justify-between border-t border-line pt-2 text-sm font-medium">
        <span>{t("Jami")}</span><span className="tabular-nums">{formatMoney(data.total)}</span>
      </p>
      {remove.error && <div className="mt-2"><ErrorNote error={remove.error} /></div>}

      {editable && (adding ? (
        <AddLine membership={membership} url={url} onCancel={() => setAdding(false)}
          onAdded={async (d) => { await refresh(d); setAdding(false); }} />
      ) : (
        <Button variant="secondary" className="mt-3 flex items-center gap-1" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden /> {t("Xizmat qo'shish")}
        </Button>
      ))}

      {receipt && <ReceiptDialog businessId={b} appointmentId={appointmentId} onClose={() => setReceipt(false)} />}
    </section>
  );
}

function AddLine({ membership, url, onAdded, onCancel }: {
  membership: Membership;
  url: string;
  onAdded: (data: VisitLines) => Promise<void>;
  onCancel: () => void;
}) {
  const b = membership.business_id;
  const v = useVocab();
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [performer, setPerformer] = useState("");            // "" = bronning o'z mutaxassisi, HOUSE, yoki xodim id
  const options = useQuery({
    queryKey: ["reception-options", b],
    queryFn: () => api<ReceptionOptions>(`/businesses/${b}/reception/options`),
  });
  const add = useMutation({
    mutationFn: () => api<VisitLines>(url, json("POST", {
      service_id: selected,
      house: performer === HOUSE,
      member_id: performer && performer !== HOUSE ? Number(performer) : null,
    })),
    onSuccess: onAdded,
  });

  if (options.isPending) return <Spinner />;
  if (options.error) return <div className="mt-3"><ErrorNote error={options.error} /></div>;
  const services = options.data.services;
  const selected = serviceId ?? services[0]?.id ?? null;
  // Shu xizmatni bajaradiganlar tepada; laborant kabi xizmatga biriktirilmaganlar ham tanlanadi
  const staff = [...options.data.staff].sort(
    (x, y) => Number(y.service_ids.includes(selected ?? 0)) - Number(x.service_ids.includes(selected ?? 0)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (selected !== null) add.mutate();
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg bg-page p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{v.serviceOne}
          <select className={inputClass} value={selected ?? ""} onChange={(e) => setServiceId(Number(e.target.value))}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {formatMoney(s.price)}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">{t("Kim bajaradi")}
          <select className={inputClass} value={performer} onChange={(e) => setPerformer(e.target.value)}>
            <option value="">{t("Shu tashrif mutaxassisi")}</option>
            <option value={HOUSE}>{t("Muassasa hisobiga (foizsiz)")}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </label>
      </div>
      {add.error && <ErrorNote error={add.error} />}
      <div className="flex gap-2">
        <Button type="submit" disabled={add.isPending || selected === null}>{t("Qo'shish")}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>{t("Bekor")}</Button>
      </div>
    </form>
  );
}
