// Super Admin: audit jurnali — kim, qachon, nimani o'zgartirdi. Yozuvlar o'zgarmaydi va o'chmaydi.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../api/client";
import type { AuditEntry, BusinessAdmin } from "../../api/types";
import { formatDate, formatTime } from "../../components/format";
import { Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";
import { BUSINESSES_KEY } from "./BusinessDialogs";

const PAGE = 50;

const ENTITY_LABELS: Record<string, string> = {
  appointment: "Bron", business: "Muassasa", subscription: "Obuna", module: "Modul", user: "Foydalanuvchi",
  member: "Xodim", payment: "To'lov", expense: "Xarajat", payroll: "Oylik", product: "Mahsulot",
  stock: "Ombor", service: "Xizmat", client: "Mijoz", password: "Parol", schedule: "Ish jadvali",
  business_hours: "Ish vaqti", compensation: "Maosh sozlamasi", expense_category: "Xarajat toifasi",
  member_services: "Xodim xizmatlari", staff_schedule: "Ish jadvali",
};
const ACTION_LABELS: Record<string, string> = {
  create: "yaratdi", update: "o'zgartirdi", delete: "o'chirdi", renew: "uzaytirdi", toggle: "yoqdi/o'chirdi",
  block: "blokladi", unblock: "blokdan chiqardi", cancel: "bekor qildi", password_viewed: "parolni ko'rdi",
  password_set: "parol berdi", refund: "qaytardi", accept: "qabul qildi", pay: "to'ladi", approve: "tasdiqladi",
  adjust: "tuzatdi", generate: "hisobladi", usage: "ishlatdi", purchase: "kirim qildi", deactivate: "nofaol qildi",
  status: "holatini o'zgartirdi", reschedule: "ko'chirdi", view_phone: "telefonni ko'rdi",
};
const entityLabel = (t: string) => ENTITY_LABELS[t] ?? t;
const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

// O'zgarishlar: qisqa "kalit: qiymat" ko'rinishida (uzun JSON chiqarilmaydi)
const isPlain = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

function valueText(v: unknown): string {
  if (isPlain(v)) return String(v);
  if (Array.isArray(v) && v.length === 0) return "bo'sh";
  // [eski, yangi] juftligi
  if (Array.isArray(v) && v.length === 2 && v.every(isPlain)) return `${String(v[0])} → ${String(v[1])}`;
  if (Array.isArray(v) && v.every(isPlain)) return v.map(String).join(", ");
  if (Array.isArray(v)) return `${v.length} ta yozuv`;
  return short(JSON.stringify(v));
}

function changesText(c: AuditEntry["changes"]): string {
  if (!c) return "";
  if (Array.isArray(c)) return valueText(c);
  return short(Object.entries(c).map(([k, v]) => `${k}: ${valueText(v)}`).join(", "), 300);
}

export function AuditPage() {
  const [business, setBusiness] = useState("");          // "" = hammasi, "platform" = muassasasiz
  const [entity, setEntity] = useState("");
  const businesses = useQuery({ queryKey: BUSINESSES_KEY, queryFn: () => api<BusinessAdmin[]>("/superadmin/businesses") });
  const types = useQuery({ queryKey: ["superadmin", "audit-types"], queryFn: () => api<string[]>("/superadmin/audit/entity-types") });

  const log = useInfiniteQuery({
    queryKey: ["superadmin", "audit", business, entity],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (business === "platform") p.set("platform_only", "true");
      else if (business) p.set("business_id", business);
      if (entity) p.set("entity_type", entity);
      if (pageParam) p.set("before_id", String(pageParam));
      return api<AuditEntry[]>(`/superadmin/audit?${p}`);
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });
  const rows = log.data?.pages.flat() ?? [];

  return (
    <div className="space-y-4">
      <PageTitle title="Audit jurnali" hint="Kim, qachon, nimani o'zgartirdi. Yozuvlarni o'zgartirib yoki o'chirib bo'lmaydi." />
      <Card className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Muassasa
          <select className={inputClass} value={business} onChange={(e) => setBusiness(e.target.value)}>
            <option value="">Hammasi</option>
            <option value="platform">Platforma (muassasasiz)</option>
            {businesses.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">Nima
          <select className={inputClass} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Hammasi</option>
            {types.data?.map((t) => <option key={t} value={t}>{entityLabel(t)}</option>)}
          </select>
        </label>
      </Card>

      {log.isLoading ? <Spinner /> : log.error ? <ErrorNote error={log.error} /> : rows.length === 0 ? (
        <Empty>Yozuv yo'q</Empty>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id} className="p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-x-3">
                  <p className="min-w-0 break-words">
                    <span className="font-medium">{a.user_name || a.user_phone || "Tizim"}</span>{" "}
                    {actionLabel(a.action)}: {entityLabel(a.entity_type)}{a.entity_id ? ` #${a.entity_id}` : ""}
                  </p>
                  <span className="text-xs text-muted tabular-nums">{formatDate(a.created_at)} {formatTime(a.created_at)}</span>
                </div>
                <p className="text-xs text-muted">{a.business_name ?? (a.business_id ? `#${a.business_id}` : "Platforma")}</p>
                {a.changes && <p className="mt-1 break-words text-xs text-muted [overflow-wrap:anywhere]">{changesText(a.changes)}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {log.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>Yana ko'rsatish</Button>
        </div>
      )}
    </div>
  );
}
