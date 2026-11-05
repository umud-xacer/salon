// Super Admin: platformadagi barcha odamlar (mijozlar, xodimlar). Qidirish va bloklash.
// Bloklangan odam darhol chiqarib yuboriladi va kira olmaydi; ma'lumotlari o'chmaydi.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { api, json } from "../../api/client";
import type { UserAdmin } from "../../api/types";
import { formatDate, ROLE_LABELS } from "../../components/format";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner, Tabs } from "../../components/ui";

type Kind = "" | "client" | "staff";
type Status = "" | "blocked";
const PAGE = 50;

export function UsersPage() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("");
  const [status, setStatus] = useState<Status>("");
  const [page, setPage] = useState(0);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  // Har harfda so'rov yubormaslik uchun biroz kutamiz
  useEffect(() => {
    const t = setTimeout(() => { setQ(text.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (q) params.set("q", q);
  if (kind) params.set("kind", kind);
  if (status) params.set("status", status);
  const list = useQuery({
    queryKey: ["superadmin", "users", q, kind, status, page],
    queryFn: () => api<{ total: number; items: UserAdmin[] }>(`/superadmin/users?${params}`),
    placeholderData: keepPreviousData,
  });

  const setUserStatus = useMutation({
    mutationFn: ({ id, value }: { id: number; value: "active" | "blocked" }) =>
      api(`/superadmin/users/${id}/status`, json("PATCH", { status: value })),
    onSuccess: () => {
      setConfirmId(null);
      return queryClient.invalidateQueries({ queryKey: ["superadmin", "users"] });
    },
  });

  const total = list.data?.total ?? 0;
  const pages = Math.max(Math.ceil(total / PAGE), 1);

  return (
    <div className="space-y-4">
      <PageTitle title="Foydalanuvchilar" hint={list.data ? `Topildi: ${total}` : undefined} />
      <Card className="space-y-3">
        <label className="relative block">
          <span className="sr-only">Qidirish</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className={`${inputClass} mt-0 pl-9`} placeholder="Ism yoki telefon raqam" value={text}
            onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-3">
          <Tabs tabs={[{ id: "", label: "Hammasi" }, { id: "client", label: "Mijozlar" }, { id: "staff", label: "Xodimlar" }]}
            value={kind} onChange={(v) => { setKind(v); setPage(0); }} />
          <Tabs tabs={[{ id: "", label: "Har qanday holat" }, { id: "blocked", label: "Bloklanganlar" }]}
            value={status} onChange={(v) => { setStatus(v); setPage(0); }} />
        </div>
      </Card>

      {setUserStatus.error && <ErrorNote error={setUserStatus.error} />}
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} /> : list.data!.items.length === 0 ? (
        <Empty>Hech kim topilmadi</Empty>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {list.data!.items.map((u) => (
              <li key={u.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="break-words">{u.full_name || "Ismsiz"}</span>
                    {u.is_superadmin && <Badge tone="gray">Super Admin</Badge>}
                    {u.status === "blocked" && <Badge tone="red">Bloklangan</Badge>}
                  </p>
                  <p className="text-muted">
                    <a className="hover:underline" href={`tel:${u.phone}`}>{u.phone}</a>
                    {" · "}ro'yxatdan: {formatDate(u.created_at)}
                    {" · "}oxirgi kirish: {u.last_login_at ? formatDate(u.last_login_at) : "yo'q"}
                  </p>
                  {(u.memberships.length > 0 || u.client_of > 0) && (
                    <p className="mt-1 text-xs text-muted">
                      {u.memberships.map((m) => `${m.business_name} — ${ROLE_LABELS[m.role] ?? m.role}`).join("; ")}
                      {u.memberships.length > 0 && u.client_of > 0 && "; "}
                      {u.client_of > 0 && `${u.client_of} ta muassasada mijoz`}
                    </p>
                  )}
                </div>
                {!u.is_superadmin && (
                  u.status === "blocked" ? (
                    <Button variant="secondary" disabled={setUserStatus.isPending}
                      onClick={() => setUserStatus.mutate({ id: u.id, value: "active" })}>Blokdan chiqarish</Button>
                  ) : confirmId === u.id ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="danger" disabled={setUserStatus.isPending}
                        onClick={() => setUserStatus.mutate({ id: u.id, value: "blocked" })}>Ha, bloklash</Button>
                      <Button variant="secondary" onClick={() => setConfirmId(null)}>Yo'q</Button>
                    </div>
                  ) : (
                    <Button variant="danger" onClick={() => setConfirmId(u.id)}>Bloklash</Button>
                  )
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Oldingi</Button>
          <span className="tabular-nums">{page + 1} / {pages}</span>
          <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Keyingi</Button>
        </div>
      )}
      <p className="text-xs text-muted">Bloklangan odam darhol tizimdan chiqariladi va kira olmaydi. Ma'lumotlari o'chmaydi.</p>
    </div>
  );
}
