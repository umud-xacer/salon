// Bekor qilish sabablari (direktor): bron bekor qilinganda qabulxona shu ro'yxatdan tanlaydi.
// Hisobotda bekor qilishlar sabab bo'yicha guruhlanadi. Yangi muassasaga standart 5 ta sabab qo'yiladi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { CancelReason } from "../../api/types";
import { Button, Card, Empty, ErrorNote, inputClass, Spinner } from "../../components/ui";

import { dyn, t } from "../../i18n";

export function CancelReasonsCard({ businessId }: { businessId: number }) {
  const queryClient = useQueryClient();
  const key = ["cancel-reasons", businessId];
  const url = `/businesses/${businessId}/cancel-reasons`;
  const list = useQuery({ queryKey: key, queryFn: () => api<CancelReason[]>(url) });
  const [name, setName] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: (n: string) => {
      const last = list.data?.at(-1)?.sort_order ?? 0;
      return api<CancelReason>(url, json("POST", { name: n, sort_order: Math.min(last + 10, 999) }));
    },
    onSuccess: async () => { setName(""); await refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`${url}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length >= 2) add.mutate(name.trim());
  };

  return (
    <Card>
      <h2 className="text-sm font-medium">{t("Bekor qilish sabablari")}</h2>
      <p className="mb-3 text-xs text-muted">
        {t("Bron bekor qilinganda shu ro'yxatdan tanlanadi. Hisobotda qaysi sabab ko'pligi ko'rinadi.")}
      </p>
      {list.isPending && <Spinner />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data?.length === 0 && <Empty>{t("Sabablar yo'q")}</Empty>}
      <ul className="divide-y divide-line">
        {list.data?.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="break-words">{dyn(r.name)}</span>
            <button type="button" className="rounded p-1.5 text-muted hover:bg-page hover:text-danger"
                    aria-label={t("O'chirish")} disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>
              <Trash2 size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input className={inputClass} maxLength={80} value={name} placeholder={t("Yangi sabab")}
               onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={add.isPending || name.trim().length < 2} aria-label={t("Qo'shish")}>
          <Plus size={16} aria-hidden />
        </Button>
      </form>
      {(add.error || remove.error) && <div className="mt-2"><ErrorNote error={add.error ?? remove.error} /></div>}
    </Card>
  );
}
