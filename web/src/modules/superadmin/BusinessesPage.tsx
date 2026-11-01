// Super Admin: barcha salonlar ro'yxat va xaritada, direktorlari bilan.
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../api/client";
import type { BusinessAdmin, ModuleInfo } from "../../api/types";
import { formatDate } from "../../components/format";
import { Button, Card, Empty, ErrorNote, PageTitle, Spinner, Tabs } from "../../components/ui";
import { BUSINESSES_KEY, BusinessDialog, CreateBusinessDialog, StatusBadge } from "./BusinessDialogs";
import { BusinessesMap } from "./Maps";

type View = "list" | "map";

export function BusinessesPage() {
  const businesses = useQuery({ queryKey: BUSINESSES_KEY, queryFn: () => api<BusinessAdmin[]>("/superadmin/businesses") });
  const modules = useQuery({ queryKey: ["superadmin", "modules"], queryFn: () => api<ModuleInfo[]>("/superadmin/modules") });
  const [view, setView] = useState<View>("list");
  const [text, setText] = useState("");
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (businesses.data ?? []).filter(
      (b) => !q || [b.name, b.city, b.owner_name, b.owner_phone].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [businesses.data, text]);

  const opened = businesses.data?.find((b) => b.id === openedId);
  const noLocation = filtered.filter((b) => b.lat === null).length;

  return (
    <>
      <PageTitle
        title="Salonlar"
        hint={businesses.data ? `Jami ${businesses.data.length} ta` : undefined}
        action={
          <Button className="flex items-center gap-1" disabled={!modules.data} onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden /> Yangi salon
          </Button>
        }
      />
      <Tabs tabs={[{ id: "list", label: "Ro'yxat" }, { id: "map", label: "Xarita" }]} value={view} onChange={setView} />
      <label className="relative mb-3 block">
        <span className="sr-only">Qidirish</span>
        <Search size={16} className="absolute top-2.5 left-3 text-muted" aria-hidden />
        <input
          className="w-full rounded-lg border border-line bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-primary"
          placeholder="Salon, shahar yoki direktor"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

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
                  <span className="min-w-48 flex-1">
                    <span className="block font-medium">{b.name} <StatusBadge b={b} /></span>
                    <span className="block text-muted">
                      {b.owner_name ?? "Direktor yo'q"}{b.owner_phone ? ` · ${b.owner_phone}` : ""}
                    </span>
                  </span>
                  <span className="text-muted">{b.staff_count} xodim</span>
                  <span className="w-36 text-right">
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
