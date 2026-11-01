import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Appointment } from "../api/types";
import { formatMoney, formatTime, STATUS_LABELS, todayIso } from "./format";
import { Badge, Card, Empty, ErrorNote, Spinner } from "./ui";

const tone = (status: string) =>
  status === "completed" ? "green" : status === "cancelled" || status === "no_show" ? "red" : status === "pending" ? "amber" : "gray";

/** Kunlik bronlar. Ustaga RLS faqat o'z bronlarini beradi, shuning uchun komponent ikkala panelga ham yaraydi. */
export function BookingList({ businessId, showMaster }: { businessId: number; showMaster: boolean }) {
  const [day, setDay] = useState(todayIso());
  const query = useQuery({
    queryKey: ["appointments", businessId, day],
    queryFn: () => api<Appointment[]>(`/businesses/${businessId}/appointments?date=${day}`),
  });

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Bronlar</h2>
        <label className="text-sm text-muted">
          <span className="sr-only">Sana</span>
          <input
            type="date"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="rounded-lg border border-line px-2 py-1 text-ink"
          />
        </label>
      </div>
      {query.isPending && <Spinner />}
      {query.error && <ErrorNote error={query.error} />}
      {query.data?.length === 0 && <Empty>Bu kunga bron yo'q</Empty>}
      <ul className="divide-y divide-line">
        {query.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
            <span className="w-24 font-medium tabular-nums">
              {formatTime(a.starts_at)}–{formatTime(a.ends_at)}
            </span>
            <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
              {a.services.join(", ") || "Xizmat"}
              <span className="block text-muted">
                {a.client_name ?? "Mijoz"}
                {showMaster && a.member_name ? ` · ${a.member_name}` : ""}
              </span>
            </span>
            {showMaster && <span className="tabular-nums">{formatMoney(a.total_price)}</span>}
            <Badge tone={tone(a.status)}>{STATUS_LABELS[a.status] ?? a.status}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
