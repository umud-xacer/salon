import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Cake, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../api/client";
import type { ClientRecord, Membership } from "../../api/types";
import { formatMoney, todayIso } from "../../components/format";
import { Badge, Button, Card, Empty, ErrorNote, PageTitle, Spinner } from "../../components/ui";
import { vocabFor } from "../vocab";
import { useVocab } from "../vocab";
import { ClientDialog } from "./ClientDialog";

import { t } from "../../i18n";

/** Tug'ilgan kuniga necha kun qoldi (0 — bugun); 7 kundan uzoq bo'lsa null */
function birthdaySoon(birth?: string | null): number | null {
  if (!birth) return null;
  const today = new Date(`${todayIso()}T00:00:00Z`);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today.getTime() + i * 86_400_000);
    if (d.getUTCMonth() + 1 === Number(birth.slice(5, 7)) && d.getUTCDate() === Number(birth.slice(8, 10))) return i;
  }
  return null;
}
const PAGE = 50;

export function ClientsPage({ membership }: { membership: Membership }) {
  const v = useVocab();
  const b = membership.business_id;
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ClientRecord | "new" | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const tags = useQuery({
    queryKey: ["client-tags", b],
    queryFn: () => api<{ tag: string; count: number }[]>(`/businesses/${b}/clients/tags`),
  });

  useEffect(() => {
    const tx = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(tx);
  }, [text]);

  const query = useInfiniteQuery({
    queryKey: ["client-list", b, q, tag],
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      api<ClientRecord[]>(`/businesses/${b}/clients?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${pageParam}`
        + (tag ? `&tag=${encodeURIComponent(tag)}` : "")),
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
  });
  const clients = query.data?.pages.flat();

  return (
    <>
      <PageTitle
        title={vocabFor(membership.business_kind).clients}
        hint={t("Tashriflar yakunlangan bronlardan hisoblanadi")}
        action={
          <Button className="flex items-center gap-1" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden /> {v.clientOne}{" "}{t("qo'shish")}
          </Button>
        }
      />
      <label className="relative mb-3 block">
        <span className="sr-only">{t("Qidirish")}</span>
        <Search size={16} className="absolute top-2.5 left-3 text-muted" aria-hidden />
        <input
          className="w-full rounded-lg border border-line bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-primary"
          placeholder={t("Ism yoki telefon")}
          maxLength={60}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {(tags.data?.length ?? 0) > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={t("Teg bo'yicha")}>
          {tags.data!.slice(0, 15).map((x) => (
            <button key={x.tag} type="button" aria-pressed={tag === x.tag}
                    onClick={() => setTag(tag === x.tag ? null : x.tag)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${tag === x.tag
                      ? "border-primary bg-primary text-white" : "border-line bg-white text-muted hover:bg-page"}`}>
              {x.tag} <span className="opacity-70">{x.count}</span>
            </button>
          ))}
        </div>
      )}
      {query.isPending && <Spinner />}
      {query.error && <ErrorNote error={query.error} />}
      {clients?.length === 0 && <Card><Empty>{q ? t("Topilmadi") : t("Hali {a} yo'q", { a: v.clientOne.toLowerCase() })}</Empty></Card>}
      {clients && clients.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {clients.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setEditing(c)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page"
              >
                <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                  <span className="flex items-center gap-1.5 font-medium break-words">
                    {c.full_name}
                    {(c.alert || c.allergies) && (
                      <AlertTriangle size={14} className="shrink-0 text-amber-600" aria-label={t("Ogohlantirish bor")} />
                    )}
                  </span>
                  <span className="block text-muted tabular-nums">{c.phone}</span>
                  {(c.tags?.length ?? 0) > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {c.tags!.map((x) => <span key={x} className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{x}</span>)}
                    </span>
                  )}
                </span>
                {birthdaySoon(c.birth_date) !== null && (
                  <Badge tone="amber">
                    <Cake size={12} className="mr-1 inline" aria-hidden />
                    {birthdaySoon(c.birth_date) === 0 ? t("Bugun tug'ilgan kuni") : t("{n} kundan keyin tug'ilgan kuni", { n: birthdaySoon(c.birth_date) })}
                  </Badge>
                )}
                {c.has_account && <Badge tone="green">{t("Ilovada")}</Badge>}
                <span className="text-muted">{t("{a} tashrif", { a: c.visits })}</span>
                <span className="tabular-nums sm:w-28 sm:text-right">{formatMoney(c.total_spent)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <div className="mt-3 text-center">
          <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t("Yana ko'rsatish")}
          </Button>
        </div>
      )}
      {editing && (
        <ClientDialog businessId={b} client={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

