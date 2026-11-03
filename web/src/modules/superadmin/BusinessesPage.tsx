// Super Admin: barcha salonlar ro'yxat va xaritada, direktorlari bilan.
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../api/client";
import type { BusinessAdmin, ModuleInfo } from "../../api/types";
import { formatDate } from "../../components/format";
import { Badge, Button, Card, Empty, ErrorNote, PageTitle, PasswordBadge, Spinner, Tabs } from "../../components/ui";
import { BUSINESSES_KEY, BusinessDialog, CreateBusinessDialog, StatusBadge } from "./BusinessDialogs";
import { useBusinessTypes } from "./BusinessTypesPage";
import { BusinessesMap } from "./Maps";

type View = "list" | "map";

// Mijoz ilovasida ko'rinishi va bron qabul qilishi uchun yetishmayotganlar
const missingFor = (b: BusinessAdmin) => [
  b.lat === null ? "lokatsiya" : null,
  b.service_count === 0 ? "xizmat" : null,
  b.hours_count === 0 ? "ish vaqti" : null,
].filter((x): x is string => x !== null);

export function BusinessesPage() {
  const businesses = useQuery({ queryKey: BUSINESSES_KEY, queryFn: () => api<BusinessAdmin[]>("/superadmin/businesses") });
  const modules = useQuery({ queryKey: ["superadmin", "modules"], queryFn: () => api<ModuleInfo[]>("/superadmin/modules") });
  const [view, setView] = useState<View>("list");
  const [text, setText] = useState("");
  const types = useBusinessTypes();
  const [typeId, setTypeId] = useState("");
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (businesses.data ?? []).filter(
      (b) => (!typeId || b.category_id === Number(typeId))
        && (!q || [b.name, b.region, b.city, b.owner_name, b.owner_phone].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [businesses.data, text, typeId]);

  const opened = businesses.data?.find((b) => b.id === openedId);
  const noLocation = filtered.filter((b) => b.lat === null).length;

  return (
    <>
      <PageTitle
        title="Salonlar"
        hint={businesses.data ? `Jami ${businesses.data.length} ta` : undefined}
        action={
          <Button className="flex items-center gap-1" disabled={!modules.data} onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden /> Yangi muassasa
          </Button>
        }
      />
      <Tabs tabs={[{ id: "list", label: "Ro'yxat" }, { id: "map", label: "Xarita" }]} value={view} onChange={setView} />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
      <label className="relative block flex-1">
        <span className="sr-only">Qidirish</span>
        <Search size={16} className="absolute top-2.5 left-3 text-muted" aria-hidden />
        <input
          className="w-full rounded-lg border border-line bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-primary"
          placeholder="Salon, shahar yoki direktor"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="block sm:w-56">
        <span className="sr-only">Muassasa turi</span>
        <select className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-primary"
          value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Barcha turlar</option>
          {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name_uz}</option>)}
        </select>
      </label>
      </div>

      {(businesses.isPending || modules.isPending) && <Spinner />}
      {(businesses.error || modules.error) && <ErrorNote error={businesses.error ?? modules.error} />}

      {view === "map" && businesses.data && (
        <>
          <BusinessesMap businesses={filtered} onSelect={(b) => setOpenedId(b.id)} />
          <p className="mt-2 text-xs text-muted">
            Yashil: faol. Sariq: to'xtatilgan. Qizil: bloklangan.
            {noLocation > 0 && ` Lokatsiyasi yo'q: ${noLocation} ta.`}
          </p>
        </>
      )}

      {view === "list" && businesses.data && (
        filtered.length === 0 ? (
          <Card><Empty>Topilmadi</Empty></Card>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {filtered.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => setOpenedId(b.id)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page"
                >
                  <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                    <span className="block font-medium">{b.name} <StatusBadge b={b} /></span>
                    <span className="block text-muted">
                      {b.owner_name ?? "Direktor yo'q"}{b.owner_phone ? ` · ${b.owner_phone}` : ""}
                    </span>
                  </span>
                  {missingFor(b).length > 0 && (
                    <span title={`Ilovada ko'rinishi uchun: ${missingFor(b).join(", ")}`}>
                      <Badge tone="amber">Tayyor emas: {missingFor(b).join(", ")}</Badge>
                    </span>
                  )}
                  <PasswordBadge status={b.owner_password_status} />
                  <span className="text-muted">{b.staff_count} xodim</span>
                  <span className="sm:w-32 sm:text-right">
                    {b.subscription_ends_at ? `${formatDate(b.subscription_ends_at)} gacha` : "Muddatsiz"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {opened && modules.data && (
        <BusinessDialog key={opened.id} business={opened} modules={modules.data} onClose={() => setOpenedId(null)} />
      )}
      {creating && modules.data && <CreateBusinessDialog modules={modules.data} onClose={() => setCreating(false)} />}
    </>
  );
}
