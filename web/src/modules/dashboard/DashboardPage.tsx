import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "../../api/client";
import type { InventorySummary, Membership } from "../../api/types";
import { BookingList } from "../../components/BookingList";
import { formatQty } from "../../components/format";
import { roleLabel, vocabFor } from "../vocab";
import { Card, PageTitle } from "../../components/ui";

import { t } from "../../i18n";
function LowStockCard({ businessId, kind, slug }: { businessId: number; kind: string; slug: string }) {
  const query = useQuery({
    queryKey: ["inventory-summary", businessId],
    queryFn: () => api<InventorySummary>(`/businesses/${businessId}/inventory/summary`),
  });
  if (!query.data?.low_count) return null;
  const { low, low_count: count } = query.data;

  return (
    <Card className="mb-4">
      <h2 className="flex items-center gap-2 text-sm font-medium text-warning">
        <AlertTriangle size={16} aria-hidden />{" "}{t("Omborda kam qoldi:")}{" "}{count}{" "}{t("ta")}
      </h2>
      <ul className="mt-2 divide-y divide-line text-sm">
        {low.map((p) => (
          <li key={p.id} className="flex justify-between gap-3 py-1.5">
            <span className="min-w-0 break-words">{p.name}</span>
            <span className="whitespace-nowrap tabular-nums">{formatQty(p.current_qty)} {p.unit}</span>
          </li>
        ))}
      </ul>
      <Link to={`/${slug}/${kind === "pharmacy" ? "dorilar" : "ombor"}`} className="mt-2 inline-block text-sm text-primary">{t("Omborga o'tish")}</Link>
    </Card>
  );
}

export function DashboardPage({ membership }: { membership: Membership }) {
  const showStock = membership.modules.includes("inventory") && membership.permissions.includes("inventory.view");
  return (
    <>
      <PageTitle title={membership.business_name} hint={roleLabel(membership.role, vocabFor(membership.business_kind))} />
      {showStock && <LowStockCard businessId={membership.business_id} kind={membership.business_kind} slug={membership.business_slug} />}
      {membership.permissions.includes("appointments.view_all") && (
        <BookingList businessId={membership.business_id} showMaster />
      )}
    </>
  );
}
