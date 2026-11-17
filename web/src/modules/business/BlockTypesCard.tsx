// Blok turlari (direktor): kalendarda vaqtni bloklashda tanlanadigan tayyor variantlar va ularning
// odatiy davomiyligi. Yangi muassasaga standart 5 ta tur qo'yiladi (Tushlik, Tanaffus, Tozalash...).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { BlockType } from "../../api/types";
import { Button, Card, Empty, ErrorNote, inputClass, Spinner } from "../../components/ui";

import { dyn, t } from "../../i18n";

const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

export function BlockTypesCard({ businessId }: { businessId: number }) {
  const queryClient = useQueryClient();
  const key = ["block-types", businessId];
  const url = `/businesses/${businessId}/block-types`;
  const list = useQuery({ queryKey: key, queryFn: () => api<BlockType[]>(url) });
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(30);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: () => {
      const last = list.data?.at(-1)?.sort_order ?? 0;
      return api<BlockType>(url, json("POST", { name: name.trim(), duration_min: duration,
                                                sort_order: Math.min(last + 10, 999) }));
    },
    onSuccess: async () => { setName(""); await refresh(); },
  });
  const update = useMutation({
    mutationFn: (bt: BlockType) => api<BlockType>(`${url}/${bt.id}`, json("PUT", bt)),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`${url}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length >= 2) add.mutate();
  };
  const error = add.error ?? update.error ?? remove.error;

  return (
    <Card>
      <h2 className="text-sm font-medium">{t("Vaqtni bloklash turlari")}</h2>
      <p className="mb-3 text-xs text-muted">
        {t("Kalendarda vaqt bloklanganda (tushlik, tozalash...) shu ro'yxatdan tanlanadi. Blok vaqtiga bron qilib bo'lmaydi.")}
      </p>
      {list.isPending && <Spinner />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data?.length === 0 && <Empty>{t("Turlar yo'q")}</Empty>}
      <ul className="divide-y divide-line">
        {list.data?.map((bt) => (
          <li key={bt.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 break-words">{dyn(bt.name)}</span>
            <select aria-label={t("Davomiyligi")} className="rounded-lg border border-line bg-white px-2 py-1 text-sm"
                    value={bt.duration_min} disabled={update.isPending}
                    onChange={(e) => update.mutate({ ...bt, duration_min: Number(e.target.value) })}>
              {(DURATIONS.includes(bt.duration_min) ? DURATIONS : [...DURATIONS, bt.duration_min].sort((a, b) => a - b))
                .map((d) => <option key={d} value={d}>{t("{n} daq", { n: d })}</option>)}
            </select>
            <button type="button" className="rounded p-1.5 text-muted hover:bg-page hover:text-danger"
                    aria-label={t("O'chirish")} disabled={remove.isPending} onClick={() => remove.mutate(bt.id)}>
              <Trash2 size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input className={inputClass} maxLength={60} value={name} placeholder={t("Yangi tur")}
               onChange={(e) => setName(e.target.value)} />
        <select aria-label={t("Davomiyligi")} className="rounded-lg border border-line bg-white px-2 text-sm"
                value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {DURATIONS.map((d) => <option key={d} value={d}>{t("{n} daq", { n: d })}</option>)}
        </select>
        <Button type="submit" disabled={add.isPending || name.trim().length < 2} aria-label={t("Qo'shish")}>
          <Plus size={16} aria-hidden />
        </Button>
      </form>
      {error && <div className="mt-2"><ErrorNote error={error} /></div>}
    </Card>
  );
}
