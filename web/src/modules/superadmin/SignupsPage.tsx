// Super Admin: o'zi ro'yxatdan o'tgan muassasalar arizalari, 5 kunlik sinov va avtomatik qadamlar jurnali (sql/070).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Send } from "lucide-react";
import { useState } from "react";

import { adminApprove, adminReject, adminSignups, adminTrialEvents, type Readiness, type SignupAdmin } from "../../api/onboarding";
import { Modal } from "../../components/Modal";
import { formatDate, formatTime } from "../../components/format";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner, Tabs } from "../../components/ui";
import { t } from "../../i18n";

type Tab = "pending" | "trial" | "converted" | "all" | "events";

const TEAM: Record<string, string> = { "1": t("Faqat o'zi"), "2-5": "2–5", "6-10": "6–10", "11-20": "11–20", "21+": "21+" };
const READY: { key: keyof Readiness; label: string }[] = [
  { key: "logged_in", label: t("Kirgan") }, { key: "services", label: t("Xizmatlar") },
  { key: "staff", label: t("Mutaxassis") }, { key: "hours", label: t("Ish vaqti") },
  { key: "location", label: t("Xaritada") }, { key: "visible", label: t("Ilovada") },
];
const EVENTS: Record<string, string> = {
  signup: t("Ariza yuborildi"), approved: t("Tasdiqlandi"), rejected: t("Rad etildi"), sms_day3: t("3-kun: SMS"),
  tg_day4: t("4-kun: Telegram"), converted: t("Obunaga o'tdi"), deleted: t("O'chirildi"), send_failed: t("Yuborilmadi"),
};
const when = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`;

function StatusBadge({ s }: { s: SignupAdmin }) {
  if (s.status === "pending") return <Badge tone="amber">{t("Kutilmoqda")}</Badge>;
  if (s.status === "converted") return <Badge tone="green">{t("Obunada")}</Badge>;
  const left = s.trial_ends_at ? Math.max(0, Math.ceil((new Date(s.trial_ends_at).getTime() - Date.now()) / 86400000)) : 0;
  return <Badge tone="gray">{t("Sinov: {a} kun qoldi", { a: left })}</Badge>;
}

function Row({ s, onApprove, onReject }: { s: SignupAdmin; onApprove: () => void; onReject: () => void }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-navy">{s.business_name}</h3>
            <StatusBadge s={s} />
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {[s.category_name, s.region, s.city].filter(Boolean).join(" · ")}
          </p>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-muted">{t("Direktor")}: </dt><dd className="inline">{s.owner_name || "—"} · {s.owner_phone}</dd></div>
            <div><dt className="inline text-muted">{t("Jamoa")}: </dt><dd className="inline">{TEAM[s.team_size] ?? s.team_size}</dd></div>
            <div><dt className="inline text-muted">{t("Aloqa")}: </dt><dd className="inline">{s.contact_phone ?? "—"}</dd></div>
            <div><dt className="inline text-muted">{t("Manzil")}: </dt><dd className="inline">{s.address ?? "—"}</dd></div>
            <div><dt className="inline text-muted">{t("Ariza")}: </dt><dd className="inline">{when(s.created_at)}</dd></div>
            <div>
              <dt className="inline text-muted">Telegram: </dt>
              <dd className="inline">{s.owner_telegram ? t("bog'langan") : t("bog'lanmagan")}</dd>
            </div>
            {s.trial_ends_at && (
              <div><dt className="inline text-muted">{t("Sinov tugashi")}: </dt><dd className="inline">{when(s.trial_ends_at)}</dd></div>
            )}
          </dl>
          {s.status !== "pending" && s.readiness && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {READY.map((r) => (
                <li key={r.key} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${s.readiness![r.key]
                  ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {s.readiness![r.key] ? <CheckCircle2 size={13} aria-hidden /> : <Circle size={13} aria-hidden />}{r.label}
                </li>
              ))}
              {s.sms_day3_at && <li className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">SMS {formatDate(s.sms_day3_at)}</li>}
              {s.tg_day4_at && <li className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700"><Send size={11} className="mr-1 inline" aria-hidden />{formatDate(s.tg_day4_at)}</li>}
            </ul>
          )}
        </div>
        {s.status === "pending" && (
          <div className="flex gap-2">
            <Button onClick={onApprove}>{t("Tasdiqlash")}</Button>
            <Button variant="danger" onClick={onReject}>{t("Rad etish")}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function SignupsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [approve, setApprove] = useState<SignupAdmin | null>(null);
  const [reject, setReject] = useState<SignupAdmin | null>(null);
  const [days, setDays] = useState("5");
  const [reason, setReason] = useState("");

  const list = useQuery({ queryKey: ["signups", tab], queryFn: () => adminSignups(tab), enabled: tab !== "events" });
  const events = useQuery({ queryKey: ["trial-events"], queryFn: adminTrialEvents, enabled: tab === "events" });
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["signups"] });
    void qc.invalidateQueries({ queryKey: ["signup-count"] });
    void qc.invalidateQueries({ queryKey: ["trial-events"] });
    setApprove(null);
    setReject(null);
    setReason("");
  };
  const approveM = useMutation({ mutationFn: () => adminApprove(approve!.business_id, Number(days) || undefined), onSuccess: done });
  const rejectM = useMutation({ mutationFn: () => adminReject(reject!.business_id, reason.trim()), onSuccess: done });

  return (
    <div>
      <PageTitle title={t("Arizalar")}
        hint={t("Muassasalar o'zi ro'yxatdan o'tadi. Tasdiqlangach bepul sinov boshlanadi; 3-kun SMS, 4-kun Telegram eslatmasi, sinov oxirida talablar bajarilmasa — avtomatik o'chiriladi.")} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "pending", label: t("Kutilmoqda") }, { id: "trial", label: t("Sinovda") },
        { id: "converted", label: t("Obunaga o'tgan") }, { id: "all", label: t("Hammasi") }, { id: "events", label: t("Jurnal") },
      ]} />

      {tab !== "events" ? (
        list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} /> : !list.data?.length ? (
          <Empty>{tab === "pending" ? t("Yangi ariza yo'q") : t("Hozircha bo'sh")}</Empty>
        ) : (
          <div className="space-y-3">
            {list.data.map((s) => (
              <Row key={s.business_id} s={s} onApprove={() => { setDays("5"); setApprove(s); }} onReject={() => setReject(s)} />
            ))}
          </div>
        )
      ) : events.isLoading ? <Spinner /> : !events.data?.length ? <Empty>{t("Jurnal bo'sh")}</Empty> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-page text-left text-muted">
              <tr><th className="px-3 py-2">{t("Vaqt")}</th><th className="px-3 py-2">{t("Muassasa")}</th>
                <th className="px-3 py-2">{t("Hodisa")}</th><th className="px-3 py-2">{t("Tafsilot")}</th></tr>
            </thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2">{when(e.created_at)}</td>
                  <td className="px-3 py-2">{e.business_name}<div className="text-xs text-muted">{e.owner_phone}</div></td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {EVENTS[e.event] ?? e.event}{e.dry_run && <span className="ml-1"><Badge tone="amber">{t("sinov rejimi")}</Badge></span>}
                  </td>
                  <td className="max-w-md px-3 py-2 text-xs text-muted">
                    <code className="break-all">{JSON.stringify(e.details)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {approve && (
        <Modal title={t("Arizani tasdiqlash")} onClose={() => setApprove(null)}>
          <p className="text-sm">{t("«{a}» faol bo'ladi va bepul sinov boshlanadi. Direktorga Telegram orqali xabar boradi.", { a: approve.business_name })}</p>
          <label className="mt-3 block text-sm">{t("Sinov muddati (kun)")}
            <input className={inputClass} type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          {approveM.error != null && <ErrorNote error={approveM.error} />}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setApprove(null)}>{t("Bekor qilish")}</Button>
            <Button disabled={approveM.isPending} onClick={() => approveM.mutate()}>{t("Tasdiqlash")}</Button>
          </div>
        </Modal>
      )}
      {reject && (
        <Modal title={t("Arizani rad etish")} onClose={() => setReject(null)}>
          <p className="text-sm">{t("«{a}» va uning ma'lumotlari o'chiriladi (direktor hisobi qoladi). Ortga qaytarib bo'lmaydi.", { a: reject.business_name })}</p>
          <label className="mt-3 block text-sm">{t("Sabab (direktorga yuboriladi)")}
            <textarea className={inputClass} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {rejectM.error != null && <ErrorNote error={rejectM.error} />}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReject(null)}>{t("Bekor qilish")}</Button>
            <Button variant="danger" disabled={rejectM.isPending} onClick={() => rejectM.mutate()}>{t("Rad etish")}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
