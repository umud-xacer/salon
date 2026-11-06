// Super Admin: muassasa direktorlari (platforma mijozlari). Tepada — obunasi tugashiga oz qolganlar.
// Qatorni bossangiz muassasa oynasi ochiladi: obunani uzaytirish, direktorni almashtirish, parol.
import { useQuery } from "@tanstack/react-query";
import { Phone, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../api/client";
import type { BusinessAdmin, ModuleInfo } from "../../api/types";
import { formatDate } from "../../components/format";
import { Badge, Card, Empty, ErrorNote, inputClass, PageTitle, PasswordBadge, Spinner, Tabs } from "../../components/ui";
import { BUSINESSES_KEY, BusinessDialog, StatusBadge } from "./BusinessDialogs";

import { t } from "../../i18n";
const SOON_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

// Obuna holati: necha kun qoldi (manfiy — o'tib ketgan), null — muddatsiz
const daysLeft = (b: BusinessAdmin) =>
  b.subscription_ends_at ? Math.ceil((new Date(b.subscription_ends_at).getTime() - Date.now()) / DAY) : null;

function LeftBadge({ b }: { b: BusinessAdmin }) {
  const d = daysLeft(b);
  if (d === null) return <Badge tone="gray">{t("Muddatsiz")}</Badge>;
  if (d <= 0) return <Badge tone="red">{t("Muddati o'tgan")}</Badge>;
  if (d <= SOON_DAYS) return <Badge tone="amber">{d}{" "}{t("kun qoldi")}</Badge>;
  return <Badge tone="green">{d}{" "}{t("kun qoldi")}</Badge>;
}

type Filter = "all" | "soon" | "blocked";

export function DirectorsPage() {
  const businesses = useQuery({ queryKey: BUSINESSES_KEY, queryFn: () => api<BusinessAdmin[]>("/superadmin/businesses") });
  const modules = useQuery({ queryKey: ["superadmin", "modules"], queryFn: () => api<ModuleInfo[]>("/superadmin/modules") });
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openedId, setOpenedId] = useState<number | null>(null);

  const all = useMemo(() => (businesses.data ?? []).filter((b) => b.owner_member_id !== null), [businesses.data]);
  // Bitta odam (bitta telefon) bir necha muassasada direktor: ismi hammasida bir xil
  const perOwner = useMemo(() => all.reduce((m, b) => m.set(b.owner_user_id ?? -b.id, (m.get(b.owner_user_id ?? -b.id) ?? 0) + 1),
    new Map<number, number>()), [all]);
  // Tugashiga oz qolgan (yoki o'tib ketgan), bloklanmagan — eng shoshilinchi birinchi
  const soon = useMemo(() => all
    .filter((b) => b.status !== "blocked" && (daysLeft(b) ?? Infinity) <= SOON_DAYS)
    .sort((a, c) => (daysLeft(a) ?? 0) - (daysLeft(c) ?? 0)), [all]);

  const list = useMemo(() => {
    const q = text.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return all
      .filter((b) => filter !== "soon" || soon.includes(b))
      .filter((b) => filter !== "blocked" || b.owner_status === "blocked" || b.status === "blocked")
      .filter((b) => !q || [b.owner_name, b.name, b.type_name].some((v) => v?.toLowerCase().includes(q))
        || (digits.length >= 3 && b.owner_phone?.includes(digits)))
      .sort((a, c) => (a.owner_name ?? "").localeCompare(c.owner_name ?? ""));
  }, [all, soon, text, filter]);

  const opened = businesses.data?.find((b) => b.id === openedId);

  if (businesses.isLoading) return <Spinner />;
  if (businesses.error) return <ErrorNote error={businesses.error} />;

  return (
    <div className="space-y-4">
      <PageTitle title={t("Direktorlar")} hint={t("{a} ta muassasa direktori", { a: all.length })} />

      <Card className={soon.length ? "border-amber-300" : ""}>
        <h2 className="mb-1 text-sm font-medium">{t("Obunasi tugashiga oz qolgan mijozlar (")}{soon.length})</h2>
        <p className="mb-2 text-xs text-muted">{SOON_DAYS}{" "}{t("kun va undan kam qolgan yoki muddati o'tgan. Bossangiz — uzaytirish oynasi.")}</p>
        {soon.length === 0 ? <Empty>{t("Yaqin kunlarda tugaydigan obuna yo'q")}</Empty> : (
          <ul className="divide-y divide-line">
            {soon.map((b) => <Row key={b.id} b={b} shared={perOwner.get(b.owner_user_id ?? -b.id) ?? 1} onOpen={() => setOpenedId(b.id)} />)}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <label className="relative block">
          <span className="sr-only">{t("Qidirish")}</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className={`${inputClass} mt-0 pl-9`} placeholder={t("Direktor ismi, telefoni yoki muassasa nomi")} value={text}
            onChange={(e) => setText(e.target.value)} />
        </label>
        <Tabs tabs={[{ id: "all", label: t("Hammasi") }, { id: "soon", label: t("Tugashi yaqin ({a})", { a: soon.length }) },
          { id: "blocked", label: t("Bloklanganlar") }]} value={filter} onChange={setFilter} />
      </Card>

      {list.length === 0 ? <Empty>{t("Hech kim topilmadi")}</Empty> : (
        <Card className="p-0">
          <ul className="divide-y divide-line px-4">
            {list.map((b) => <Row key={b.id} b={b} shared={perOwner.get(b.owner_user_id ?? -b.id) ?? 1} onOpen={() => setOpenedId(b.id)} />)}
          </ul>
        </Card>
      )}

      {opened && modules.data && (
        <BusinessDialog key={opened.id} business={opened} modules={modules.data} onClose={() => setOpenedId(null)} />
      )}
    </div>
  );
}

function Row({ b, shared, onOpen }: { b: BusinessAdmin; shared: number; onOpen: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left hover:underline">
        <span className="block font-medium break-words">{b.owner_name || t("Ismsiz")}</span>
        <span className="block text-xs text-muted break-words">
          {b.name}{b.type_name ? ` · ${b.type_name}` : ""}{" "}{t("· oxirgi kirish:")}{" "}{b.owner_last_login_at ? formatDate(b.owner_last_login_at) : t("yo'q")}
        </span>
      </button>
      {b.owner_phone && (
        <a href={`tel:${b.owner_phone}`} className="inline-flex items-center gap-1 tabular-nums text-primary hover:underline">
          <Phone size={14} aria-hidden /> {b.owner_phone}
        </a>
      )}
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge b={b} />
        {b.owner_status === "blocked" && <Badge tone="red">{t("Direktor bloklangan")}</Badge>}
        {shared > 1 && <span title={t("Bitta telefon raqami bir necha muassasada direktor: ismi hammasida bir xil")}><Badge tone="amber">{t("Bitta raqam:")}{" "}{shared}{" "}{t("ta muassasa")}</Badge></span>}
        <PasswordBadge status={b.owner_password_status} />
        <LeftBadge b={b} />
        {b.subscription_ends_at && <span className="text-xs text-muted">{formatDate(b.subscription_ends_at)}{" "}{t("gacha")}</span>}
      </span>
    </li>
  );
}
