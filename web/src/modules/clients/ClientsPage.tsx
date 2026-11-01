import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { Appointment, ClientRecord, Membership } from "../../api/types";
import { formatDate, formatMoney, formatTime, normalizePhone, STATUS_LABELS } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";

const PAGE = 50;

export function ClientsPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ClientRecord | "new" | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const query = useInfiniteQuery({
    queryKey: ["client-list", b, q],
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      api<ClientRecord[]>(`/businesses/${b}/clients?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${pageParam}`),
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
  });
  const clients = query.data?.pages.flat();

  return (
    <>
      <PageTitle
        title="Mijozlar"
        hint="Tashriflar yakunlangan bronlardan hisoblanadi"
        action={
          <Button className="flex items-center gap-1" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden /> Mijoz qo'shish
          </Button>
        }
      />
      <label className="relative mb-3 block">
        <span className="sr-only">Qidirish</span>
        <Search size={16} className="absolute top-2.5 left-3 text-muted" aria-hidden />
        <input
          className="w-full rounded-lg border border-line bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-primary"
          placeholder="Ism yoki telefon"
          maxLength={60}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {query.isPending && <Spinner />}
      {query.error && <ErrorNote error={query.error} />}
      {clients?.length === 0 && <Card><Empty>{q ? "Topilmadi" : "Hali mijoz yo'q"}</Empty></Card>}
      {clients && clients.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {clients.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setEditing(c)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page"
              >
                <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                  <span className="block font-medium break-words">{c.full_name}</span>
                  <span className="block text-muted tabular-nums">{c.phone}</span>
                </span>
                {c.has_account && <Badge tone="green">Ilovada</Badge>}
                <span className="text-muted">{c.visits} tashrif</span>
                <span className="tabular-nums sm:w-28 sm:text-right">{formatMoney(c.total_spent)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <div className="mt-3 text-center">
          <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Yana ko'rsatish
          </Button>
        </div>
      )}
      {editing && (
        <ClientDialog businessId={b} client={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function ClientDialog({ businessId, client, onClose }: {
  businessId: number;
  client: ClientRecord | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const url = `/businesses/${businessId}/clients`;
  const [name, setName] = useState(client?.full_name ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");

  const history = useQuery({
    queryKey: ["client-history", businessId, client?.id],
    enabled: client !== null,
    queryFn: () => api<Appointment[]>(`${url}/${client!.id}/appointments`),
  });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { full_name: name.trim(), notes: notes.trim() || null };
      if (!client?.has_account) body.phone = normalizePhone(phone);
      return client ? api(`${url}/${client.id}`, json("PATCH", body)) : api(url, json("POST", body));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client-list", businessId] });
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal title={client ? client.full_name : "Yangi mijoz"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Ism familiya
            <input className={inputClass} required minLength={2} maxLength={120} value={name}
              onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">Telefon
            <input className={inputClass} type="tel" required disabled={client?.has_account} value={phone}
              onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        {client?.has_account && (
          <p className="text-xs text-muted">Mijoz ilovadan foydalanadi, telefonini faqat o'zi o'zgartiradi.</p>
        )}
        <label className="block text-sm">Izoh
          <textarea className={inputClass} rows={2} maxLength={2000} placeholder="Allergiya, afzalliklar" value={notes}
            onChange={(e) => setNotes(e.target.value)} />
        </label>
        {save.error && <ErrorNote error={save.error} />}
        <Button type="submit" disabled={save.isPending}>Saqlash</Button>
      </form>

      {client && (
        <section className="mt-5 border-t border-line pt-4">
          <h3 className="mb-1 text-sm font-medium">Bronlar tarixi</h3>
          {history.isPending && <Spinner />}
          {history.error && <ErrorNote error={history.error} />}
          {history.data?.length === 0 && <Empty>Bron yo'q</Empty>}
          <ul className="max-h-56 divide-y divide-line overflow-y-auto text-sm">
            {history.data?.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="tabular-nums">{formatDate(a.starts_at)} {formatTime(a.starts_at)}</span>
                <span className="min-w-32 flex-1 truncate">{a.services.join(", ")}</span>
                <span className="text-muted">{STATUS_LABELS[a.status] ?? a.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
