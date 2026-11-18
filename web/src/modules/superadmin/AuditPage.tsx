// Super Admin: audit jurnali — kim, qachon, nimani o'zgartirdi. Yozuvlar o'zgarmaydi va o'chmaydi.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { AuditEntry, BusinessAdmin } from "../../api/types";
import { formatDate, formatTime } from "../../components/format";
import { Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";
import { BUSINESSES_KEY } from "./BusinessDialogs";

import { t } from "../../i18n";
const PAGE = 50;

const ENTITY_LABELS: Record<string, string> = {
  appointment: t("Bron"), business: t("Muassasa"), subscription: t("Obuna"), module: t("Modul"), user: t("Foydalanuvchi"),
  member: t("Xodim"), payment: t("To'lov"), expense: t("Xarajat"), payroll: t("Oylik"), product: t("Mahsulot"),
  stock: t("Ombor"), service: t("Xizmat"), client: t("Mijoz"), password: t("Parol"), schedule: t("Ish jadvali"),
  business_hours: t("Ish vaqti"), compensation: t("Maosh sozlamasi"), expense_category: t("Xarajat toifasi"),
  member_services: t("Xodim xizmatlari"), staff_schedule: t("Ish jadvali"), security: t("Xavfsizlik (IP blok)"),
};
const ACTION_LABELS: Record<string, string> = {
  create: t("yaratdi"), update: t("o'zgartirdi"), delete: t("o'chirdi"), renew: t("uzaytirdi"), toggle: t("yoqdi/o'chirdi"),
  block: t("blokladi"), unblock: t("blokdan chiqardi"), cancel: t("bekor qildi"), password_viewed: t("parolni ko'rdi"),
  password_set: t("parol berdi"), refund: t("qaytardi"), accept: t("qabul qildi"), pay: t("to'ladi"), approve: t("tasdiqladi"),
  adjust: t("tuzatdi"), generate: t("hisobladi"), usage: t("ishlatdi"), purchase: t("kirim qildi"), deactivate: t("nofaol qildi"),
  status: t("holatini o'zgartirdi"), reschedule: t("ko'chirdi"), view_phone: t("telefonni ko'rdi"),
  ip_block: t("avtomatik blokladi"), ip_unblock: t("blokdan chiqardi"),
};
const entityLabel = (tx: string) => ENTITY_LABELS[tx] ?? tx;
const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

// O'zgarishlar: qisqa "kalit: qiymat" ko'rinishida (uzun JSON chiqarilmaydi)
const isPlain = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

function valueText(v: unknown): string {
  if (isPlain(v)) return String(v);
  if (Array.isArray(v) && v.length === 0) return t("bo'sh");
  // [eski, yangi] juftligi
  if (Array.isArray(v) && v.length === 2 && v.every(isPlain)) return `${String(v[0])} → ${String(v[1])}`;
  if (Array.isArray(v) && v.every(isPlain)) return v.map(String).join(", ");
  if (Array.isArray(v)) return t("{a} ta yozuv", { a: v.length });
  return short(JSON.stringify(v));
}

function changesText(c: AuditEntry["changes"]): string {
  if (!c) return "";
  if (Array.isArray(c)) return valueText(c);
  return short(Object.entries(c).map(([k, v]) => `${k}: ${valueText(v)}`).join(", "), 300);
}

// Hozir vaqtincha bloklangan IP/qurilmalar (app/core/ip_guard.py): sabab, qancha qoldi, qo'lda ochish
type Blocked = { ip: string; user_id: number | null; reason: string; since: string; seconds_left: number; user_agent: string };
const REASONS: Record<string, string> = {
  rate: t("Juda ko'p so'rov"), errors: t("Ko'p xato so'rov (skanerlash)"), auth: t("Parol/kodni taxmin qilish"),
};

function BlockedCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["superadmin", "blocked-ips"], queryFn: () => api<Blocked[]>("/superadmin/security/blocked"),
    refetchInterval: 30_000 });
  const unblock = useMutation({
    mutationFn: (ip: string) => api(`/superadmin/security/blocked?ip=${encodeURIComponent(ip)}`, json("DELETE", {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["superadmin"] }),
  });
  if (!q.data) return null;
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <ShieldAlert size={18} className={q.data.length ? "text-danger" : "text-muted"} aria-hidden />
        <h2 className="font-semibold text-navy">{t("Hozir bloklangan IP'lar")}</h2>
        <span className="text-xs text-muted">{t("10 daqiqadan keyin o'zi ochiladi. Tarix — pastda \"Xavfsizlik\" bo'yicha.")}</span>
      </div>
      {q.data.length === 0 ? <p className="text-sm text-muted">{t("Bloklangan IP yo'q")}</p> : (
        <ul className="divide-y divide-line text-sm">
          {q.data.map((b) => (
            <li key={`${b.ip}-${b.user_id ?? ""}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="font-mono font-medium">{b.ip}</span>
              {b.user_id && <span className="text-xs text-muted">{t("foydalanuvchi #{a}", { a: b.user_id })}</span>}
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-danger">{REASONS[b.reason] ?? b.reason}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted" title={b.user_agent}>{b.user_agent}</span>
              <span className="text-xs tabular-nums text-muted">{t("{a} daq qoldi", { a: Math.max(1, Math.round(b.seconds_left / 60)) })}</span>
              <Button variant="secondary" disabled={unblock.isPending} onClick={() => unblock.mutate(b.ip)}>{t("Blokdan chiqarish")}</Button>
            </li>
          ))}
        </ul>
      )}
      {unblock.error && <ErrorNote error={unblock.error} />}
    </Card>
  );
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
      <PageTitle title={t("Audit jurnali")} hint={t("Kim, qachon, nimani o'zgartirdi. Yozuvlarni o'zgartirib yoki o'chirib bo'lmaydi.")} />
      <BlockedCard />
      <Card className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{t("Muassasa")}
          <select className={inputClass} value={business} onChange={(e) => setBusiness(e.target.value)}>
            <option value="">{t("Hammasi")}</option>
            <option value="platform">{t("Platforma (muassasasiz)")}</option>
            {businesses.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">{t("Nima")}
          <select className={inputClass} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">{t("Hammasi")}</option>
            {types.data?.map((tx) => <option key={tx} value={tx}>{entityLabel(tx)}</option>)}
          </select>
        </label>
      </Card>

      {log.isLoading ? <Spinner /> : log.error ? <ErrorNote error={log.error} /> : rows.length === 0 ? (
        <Empty>{t("Yozuv yo'q")}</Empty>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id} className="p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-x-3">
                  <p className="min-w-0 break-words">
                    <span className="font-medium">{a.user_name || a.user_phone || t("Tizim")}</span>{" "}
                    {actionLabel(a.action)}: {entityLabel(a.entity_type)}{a.entity_id ? ` #${a.entity_id}` : ""}
                  </p>
                  <span className="text-xs text-muted tabular-nums">{formatDate(a.created_at)} {formatTime(a.created_at)}</span>
                </div>
                <p className="text-xs text-muted">{a.business_name ?? (a.business_id ? `#${a.business_id}` : t("Platforma"))}</p>
                {a.changes && <p className="mt-1 break-words text-xs text-muted [overflow-wrap:anywhere]">{changesText(a.changes)}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {log.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>{t("Yana ko'rsatish")}</Button>
        </div>
      )}
    </div>
  );
}
