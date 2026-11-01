import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { BusinessAdmin, ModuleInfo } from "../../api/types";
import { dayOf, formatDate, normalizePhone, todayIso } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, ErrorNote, inputClass, Tabs } from "../../components/ui";
import { MembersPanel } from "../staff/MembersPanel";
import { LocationPicker } from "./Maps";

export const BUSINESSES_KEY = ["superadmin", "businesses"];

interface Category {
  id: number;
  name_uz: string;
}

function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/catalog/categories"),
    staleTime: Infinity,
  });
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[''`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function StatusBadge({ b }: { b: BusinessAdmin }) {
  if (b.status === "blocked") return <Badge tone="red">Bloklangan</Badge>;
  if (!b.operational) return <Badge tone="amber">To'xtatilgan</Badge>;
  return <Badge tone="green">Faol</Badge>;
}

export function CreateBusinessDialog({ modules, onClose }: { modules: ModuleInfo[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("Toshkent");
  const [address, setAddress] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [days, setDays] = useState("30");
  const [picked, setPicked] = useState<string[]>(["booking"]);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api("/superadmin/businesses", json("POST", {
        name: name.trim(),
        slug,
        category_id: Number(category || categories.data?.[0]?.id),
        city: city.trim() || null,
        address: address.trim() || null,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        owner_full_name: ownerName.trim(),
        owner_phone: normalizePhone(ownerPhone),
        modules: picked,
        subscription_days: days ? Number(days) : null,
      })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BUSINESSES_KEY });
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Modal title="Yangi salon" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Salon nomi
          <input className={inputClass} required minLength={2} maxLength={120} value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }} />
        </label>
        <label className="block text-sm">Havola nomi (lotin harflari)
          <input className={inputClass} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={140} value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Turi
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name_uz}</option>)}
            </select>
          </label>
          <label className="block text-sm">Shahar
            <input className={inputClass} maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">Manzil
          <input className={inputClass} maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <div className="text-sm">
          <p className="mb-1">Lokatsiya</p>
          <LocationPicker lat={point?.lat ?? null} lng={point?.lng ?? null} onChange={(lat, lng) => setPoint({ lat, lng })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Direktor ismi
            <input className={inputClass} required minLength={2} maxLength={120} value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)} />
          </label>
          <label className="block text-sm">Direktor telefoni
            <input className={inputClass} type="tel" required placeholder="90 123 45 67" value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">Obuna (kun, bo'sh qolsa muddatsiz)
          <input className={inputClass} type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <fieldset>
          <legend className="text-sm">Modullar</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {modules.map((m) => (
              <label key={m.code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={picked.includes(m.code)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, m.code] : picked.filter((x) => x !== m.code))} />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
        {create.error && <ErrorNote error={create.error} />}
        <Button type="submit" disabled={create.isPending} className="w-full">Salonni yaratish</Button>
      </form>
    </Modal>
  );
}

type Tab = "info" | "subscription" | "modules" | "staff";

const TABS: { id: Tab; label: string }[] = [
  { id: "info", label: "Ma'lumot" },
  { id: "subscription", label: "Obuna" },
  { id: "modules", label: "Modullar" },
  { id: "staff", label: "Xodimlar" },
];

export function BusinessDialog({ business: b, modules, onClose }: {
  business: BusinessAdmin;
  modules: ModuleInfo[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("info");
  return (
    <Modal title={b.name} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">
        Direktor: {b.owner_name ?? "yo'q"}{b.owner_phone ? ` · ${b.owner_phone}` : ""} <StatusBadge b={b} />
      </p>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "info" && <InfoTab business={b} />}
      {tab === "subscription" && <SubscriptionTab business={b} />}
      {tab === "modules" && <ModulesTab business={b} modules={modules} />}
      {tab === "staff" && <MembersPanel businessId={b.id} canManageManagers />}
    </Modal>
  );
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: BUSINESSES_KEY });
}

function InfoTab({ business: b }: { business: BusinessAdmin }) {
  const refresh = useRefresh();
  const categories = useCategories();
  const [name, setName] = useState(b.name);
  const [category, setCategory] = useState(String(b.category_id));
  const [city, setCity] = useState(b.city ?? "");
  const [address, setAddress] = useState(b.address ?? "");
  const [lat, setLat] = useState(b.lat);
  const [lng, setLng] = useState(b.lng);

  const save = useMutation({
    mutationFn: () =>
      api(`/superadmin/businesses/${b.id}`, json("PATCH", {
        name: name.trim(),
        category_id: Number(category),
        city: city.trim() || null,
        address: address.trim() || null,
        lat,
        lng,
      })),
    onSuccess: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">Nomi
        <input className={inputClass} required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Turi
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name_uz}</option>)}
          </select>
        </label>
        <label className="block text-sm">Shahar
          <input className={inputClass} maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm">Manzil
        <input className={inputClass} maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <div className="text-sm">
        <p className="mb-1">Lokatsiya</p>
        <LocationPicker lat={lat} lng={lng} onChange={(a, o) => { setLat(a); setLng(o); }} />
      </div>
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>Saqlash</Button>
        {save.isSuccess && <span className="text-sm text-success">Saqlandi</span>}
      </div>
    </form>
  );
}

function SubscriptionTab({ business: b }: { business: BusinessAdmin }) {
  const refresh = useRefresh();
  const [date, setDate] = useState(b.subscription_ends_at ? dayOf(b.subscription_ends_at) : "");
  const [confirming, setConfirming] = useState(false);
  const base = `/superadmin/businesses/${b.id}`;

  const renew = useMutation({
    mutationFn: (days: number) => api<BusinessAdmin>(`${base}/subscription/renew`, json("POST", { days })),
    onSuccess: (r) => {
      if (r.subscription_ends_at) setDate(dayOf(r.subscription_ends_at));
      return refresh();
    },
  });
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`${base}/subscription`, json("PATCH", body)),
    onSuccess: () => {
      setConfirming(false);
      return refresh();
    },
  });
  const block = useMutation({
    mutationFn: (status: string) => api(`${base}/status`, json("PATCH", { status })),
    onSuccess: refresh,
  });
  const error = renew.error ?? update.error ?? block.error;

  return (
    <div className="space-y-4 text-sm">
      <p>
        Hozir: {b.subscription_ends_at ? `${formatDate(b.subscription_ends_at)} gacha` : "muddatsiz"}
        {!b.is_active && " (to'xtatilgan)"}
      </p>
      <div className="flex flex-wrap gap-2">
        {[30, 90, 365].map((d) => (
          <Button key={d} disabled={renew.isPending} onClick={() => renew.mutate(d)}>+{d} kun</Button>
        ))}
      </div>
      <label className="block max-w-xs">Aniq sana (kun oxirigacha)
        <input className={inputClass} type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!date || update.isPending}
          onClick={() => update.mutate({ subscription_ends_at: `${date}T23:59:59+05:00`, is_active: true })}>
          Sanani saqlash
        </Button>
        <Button variant="secondary" disabled={update.isPending}
          onClick={() => { setDate(""); update.mutate({ subscription_ends_at: null, is_active: true }); }}>
          Muddatsiz qilish
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {b.is_active ? (
          confirming ? (
            <>
              <Button variant="danger" onClick={() => update.mutate({ is_active: false })}>Ha, to'xtatish</Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>Yo'q</Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>Obunani to'xtatish</Button>
          )
        ) : (
          <Button onClick={() => update.mutate({ is_active: true })}>Obunani yoqish</Button>
        )}
        {b.status === "blocked" ? (
          <Button variant="secondary" onClick={() => block.mutate("active")}>Blokdan chiqarish</Button>
        ) : (
          <Button variant="danger" onClick={() => block.mutate("blocked")}>Bloklash</Button>
        )}
      </div>
      <p className="text-xs text-muted">To'xtatish yoki bloklash ma'lumotni o'chirmaydi. Blokni to'lov ochmaydi.</p>
      {error && <ErrorNote error={error} />}
    </div>
  );
}

function ModulesTab({ business: b, modules }: { business: BusinessAdmin; modules: ModuleInfo[] }) {
  const refresh = useRefresh();
  const toggle = useMutation({
    mutationFn: ({ code, enabled }: { code: string; enabled: boolean }) =>
      api(`/superadmin/businesses/${b.id}/modules/${code}`, json("PUT", { enabled })),
    onSettled: refresh,
  });

  return (
    <>
      <div className="space-y-2">
        {modules.map((m) => (
          <label key={m.code} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" disabled={toggle.isPending}
              checked={b.modules.includes(m.code)}
              onChange={(e) => toggle.mutate({ code: m.code, enabled: e.target.checked })} />
            {m.name}
          </label>
        ))}
      </div>
      {toggle.error && <div className="mt-3"><ErrorNote error={toggle.error} /></div>}
    </>
  );
}
