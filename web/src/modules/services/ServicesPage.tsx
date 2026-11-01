import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { Membership, Service, ServiceCategory } from "../../api/types";
import { formatMoney } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";

export function ServicesPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const services = useQuery({ queryKey: ["services", b], queryFn: () => api<Service[]>(`/businesses/${b}/services`) });
  const categories = useQuery({
    queryKey: ["service-categories", b],
    queryFn: () => api<ServiceCategory[]>(`/businesses/${b}/service-categories`),
  });
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const cats = categories.data ?? [];

  const groups = [
    ...cats.map((c) => ({ id: c.id as number | null, name: c.name })),
    { id: null, name: "Boshqa" },
  ]
    .map((g) => ({ ...g, items: services.data?.filter((s) => s.category_id === g.id) ?? [] }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <PageTitle
        title="Xizmatlar"
        hint="Narx o'zgarsa, eski bronlar narxi saqlanib qoladi"
        action={
          <Button className="flex items-center gap-1" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden /> Xizmat qo'shish
          </Button>
        }
      />
      {services.isPending && <Spinner />}
      {services.error && <ErrorNote error={services.error} />}
      {services.data?.length === 0 && <Card><Empty>Hali xizmat yo'q</Empty></Card>}
      <div className="space-y-4">
        {groups.map((g) => (
          <section key={g.id ?? "other"}>
            <h2 className="mb-1 text-sm font-medium text-muted">{g.name}</h2>
            <ul className="divide-y divide-line rounded-xl border border-line bg-white">
              {g.items.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => setEditing(s)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page"
                  >
                    <span className="min-w-40 flex-1 font-medium">{s.name}</span>
                    {!s.is_active && <Badge tone="gray">Yashirilgan</Badge>}
                    <span className="text-muted tabular-nums">{s.duration_min} daqiqa</span>
                    <span className="w-28 text-right tabular-nums">{formatMoney(s.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Categories businessId={b} categories={cats} />
      {editing && (
        <ServiceDialog
          businessId={b}
          service={editing === "new" ? null : editing}
          categories={cats}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ServiceDialog({ businessId, service, categories, onClose }: {
  businessId: number;
  service: Service | null;
  categories: ServiceCategory[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(service?.name ?? "");
  const [duration, setDuration] = useState(String(service?.duration_min ?? 30));
  const [price, setPrice] = useState(String(service?.price ?? ""));
  const [category, setCategory] = useState(service?.category_id ? String(service.category_id) : "");
  const [description, setDescription] = useState(service?.description ?? "");
  const url = `/businesses/${businessId}/services`;

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["services", businessId] });
    await queryClient.invalidateQueries({ queryKey: ["reception-options", businessId] });
    onClose();
  };
  const save = useMutation({
    mutationFn: (extra: Record<string, unknown> = {}) => {
      const body = {
        name: name.trim(),
        duration_min: Number(duration),
        price: Number(price),
        category_id: category ? Number(category) : null,
        description: description.trim() || null,
        ...extra,
      };
      return service ? api(`${url}/${service.id}`, json("PATCH", body)) : api(url, json("POST", body));
    },
    onSuccess: done,
  });
  const hide = useMutation({
    mutationFn: () => api(`${url}/${service!.id}`, { method: "DELETE" }),
    onSuccess: done,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({});
  };

  return (
    <Modal title={service ? "Xizmatni tahrirlash" : "Yangi xizmat"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Nomi
          <input className={inputClass} required minLength={2} maxLength={120} value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Davomiyligi (daqiqa)
            <input className={inputClass} type="number" required min={5} max={720} step={5} value={duration}
              onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="block text-sm">Narxi (so'm)
            <input className={inputClass} type="number" required min={0} step={1000} value={price}
              onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">Toifa
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Boshqa</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">Tavsif
          <textarea className={inputClass} rows={2} maxLength={2000} value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </label>
        {(save.error || hide.error) && <ErrorNote error={save.error ?? hide.error} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>Saqlash</Button>
          {service?.is_active && (
            <Button type="button" variant="danger" disabled={hide.isPending} onClick={() => hide.mutate()}>
              Yashirish
            </Button>
          )}
          {service && !service.is_active && (
            <Button type="button" variant="secondary" onClick={() => save.mutate({ is_active: true })}>
              Qayta yoqish
            </Button>
          )}
        </div>
        {service && <p className="text-xs text-muted">Xizmat o'chirilmaydi, yashiriladi: eski bronlar va hisobotlar buzilmaydi.</p>}
      </form>
    </Modal>
  );
}

function Categories({ businessId, categories }: { businessId: number; categories: ServiceCategory[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const url = `/businesses/${businessId}/service-categories`;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["service-categories", businessId] });
    await queryClient.invalidateQueries({ queryKey: ["services", businessId] });
  };
  const add = useMutation({
    mutationFn: () => api(url, json("POST", { name: name.trim() })),
    onSuccess: () => {
      setName("");
      return refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`${url}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <Card className="mt-6">
      <h2 className="mb-2 text-sm font-medium">Toifalar</h2>
      <ul className="mb-3 flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-1 rounded-full bg-page px-3 py-1 text-sm">
            {c.name}
            <button aria-label={`${c.name} toifasini o'chirish`} className="text-muted hover:text-danger"
              onClick={() => remove.mutate(c.id)}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex gap-2">
        <input aria-label="Yangi toifa" placeholder="Yangi toifa" className={`${inputClass} mt-0`} required maxLength={80}
          value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={add.isPending}>Qo'shish</Button>
      </form>
      {(add.error || remove.error) && <div className="mt-2"><ErrorNote error={add.error ?? remove.error} /></div>}
    </Card>
  );
}
