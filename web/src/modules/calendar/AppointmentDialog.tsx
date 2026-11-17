import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { Appointment, CancelReason, Membership } from "../../api/types";
import { formatDate, formatMoney, formatTime, STATUS_LABELS } from "../../components/format";
import { Button, ErrorNote, inputClass, Spinner } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { PaymentPanel } from "../finance/PaymentPanel";
import { useVocab } from "../vocab";
import { VisitPanel } from "./VisitPanel";

import { dyn, pickList, t } from "../../i18n";
const OPEN = ["pending", "confirmed"];
const OTHER = "__other__";

export function AppointmentDialog({ membership, appointment: a, masterName, onClose }: {
  membership: Membership;
  appointment: Appointment;
  masterName: string;
  onClose: () => void;
}) {
  const b = membership.business_id;
  const v = useVocab();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const canManage = membership.permissions.includes("appointments.manage");
  const showPayments = membership.modules.includes("finance")
    && (membership.permissions.includes("payments.accept") || membership.permissions.includes("finance.view"))
    && a.status !== "cancelled" && a.status !== "no_show";     // oldindan to'lov: mijoz kelmasidan ham olinadi
  const showLines = membership.permissions.includes("appointments.view_all")
    || membership.permissions.includes("payments.accept");

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["calendar", b] });
    await queryClient.invalidateQueries({ queryKey: ["appointments", b] });
    // Bekor qilinsa server kutish ro'yxatini darhol tekshiradi — banner yangilansin
    await queryClient.invalidateQueries({ queryKey: ["waitlist-summary", b] });
    await queryClient.invalidateQueries({ queryKey: ["waitlist", b] });
    onClose();
  };
  const setStatus = useMutation({
    mutationFn: (status: string) =>
      api(`/businesses/${b}/appointments/${a.id}/status`, json("PATCH", { status })),
    onSuccess: done,
  });
  const cancel = useMutation({
    mutationFn: (reason: string | null) => api(`/appointments/${a.id}/cancel`, json("POST", { reason })),
    onSuccess: done,
  });
  // "Mijoz keldi" — alohida belgi: bron hali boshlanmagan, usta va qabulxona mijoz kutayotganini ko'radi
  const arrive = useMutation({
    mutationFn: (arrived: boolean) =>
      api(`/businesses/${b}/appointments/${a.id}/arrived`, json("POST", { arrived })),
    onSuccess: done,
  });
  const canArrive = canManage || membership.permissions.includes("appointments.manage_own");
  const busy = setStatus.isPending || cancel.isPending || arrive.isPending;

  return (
    <Modal title={a.client_name ?? v.clientOne} onClose={onClose}>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{t("Vaqt")}</dt>
        <dd className="tabular-nums">
          {formatDate(a.starts_at)}, {formatTime(a.starts_at)}–{formatTime(a.ends_at)}
        </dd>
        {!showLines && <><dt className="text-muted">{t("Xizmat")}</dt><dd>{pickList(a.services, a.services_ru).join(", ")}</dd></>}
        <dt className="text-muted">{v.staffOne}</dt>
        <dd>{masterName}</dd>
        {!showLines && <><dt className="text-muted">{t("Narx")}</dt><dd>{formatMoney(a.total_price)}</dd></>}
        {a.client_phone && (
          <>
            <dt className="text-muted">{t("Telefon")}</dt>
            <dd>
              <a className="text-primary" href={`tel:${a.client_phone}`}>
                {a.client_phone}
              </a>
            </dd>
          </>
        )}
        <dt className="text-muted">{t("Holat")}</dt>
        <dd>
          {STATUS_LABELS[a.status] ?? a.status}
          {a.arrived_at && OPEN.includes(a.status) && (
            <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
              {t("Keldi {a}", { a: formatTime(a.arrived_at) })}
            </span>
          )}
        </dd>
        {a.cancel_reason && a.status === "cancelled" && <><dt className="text-muted">{t("Sabab")}</dt><dd className="break-words">{a.cancel_reason}</dd></>}
      </dl>

      {(a.client_allergies || a.client_alert) && (
        <div className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {a.client_allergies && <p><span className="font-medium">{t("Allergiya")}:</span> {a.client_allergies}</p>}
          {a.client_alert && <p><span className="font-medium">{t("Ogohlantirish")}:</span> {a.client_alert}</p>}
        </div>
      )}

      {a.status === "pending" && a.confirm_by && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("{a} ilovadan bron qildi. {b} {c} gacha tasdiqlanmasa, bron avtomatik bekor qilinadi va vaqt bo'shaydi.", { a: v.clientOne, b: formatDate(a.confirm_by), c: formatTime(a.confirm_by) })}
        </p>
      )}

      {showLines && <VisitPanel membership={membership} appointmentId={a.id} />}
      {showPayments && <PaymentPanel membership={membership} appointmentId={a.id} />}

      {(setStatus.error || cancel.error || arrive.error) && (
        <div className="mt-3">
          <ErrorNote error={setStatus.error ?? cancel.error ?? arrive.error} />
        </div>
      )}

      {canManage && confirmCancel && OPEN.includes(a.status) && (
        <CancelForm businessId={b} busy={busy} onBack={() => setConfirmCancel(false)}
                    onConfirm={(reason) => cancel.mutate(reason)} />
      )}

      {!confirmCancel && (canManage || canArrive) && (OPEN.includes(a.status) || a.status === "in_progress") && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          {canManage && a.status === "pending" && !a.arrived_at && (
            <Button disabled={busy} onClick={() => setStatus.mutate("confirmed")}>
              {t("Tasdiqlash")}
            </Button>
          )}
          {OPEN.includes(a.status) && canArrive && !a.arrived_at && (
            <Button disabled={busy} onClick={() => arrive.mutate(true)}>
              {t("{a} keldi", { a: v.clientOne })}
            </Button>
          )}
          {OPEN.includes(a.status) && canManage && (
            <>
              <Button disabled={busy} variant={a.arrived_at ? "primary" : "secondary"}
                      onClick={() => setStatus.mutate("in_progress")}>
                {t("Boshlash")}
              </Button>
              {!a.arrived_at && (
                <Button disabled={busy} variant="secondary" onClick={() => setStatus.mutate("no_show")}>
                  {t("Kelmadi")}
                </Button>
              )}
              <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                {t("Bekor qilish")}
              </Button>
            </>
          )}
          {OPEN.includes(a.status) && canArrive && a.arrived_at && (
            <Button disabled={busy} variant="secondary" onClick={() => arrive.mutate(false)}>
              {t("\"Keldi\" belgisini olib tashlash")}
            </Button>
          )}
          {canManage && a.status === "in_progress" && (
            <Button disabled={busy} onClick={() => setStatus.mutate("completed")}>
              {t("Yakunlash")}
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Bekor qilish: salon ro'yxatidan sabab (Sozlamalar → Bekor qilish sabablari) yoki o'z matni */
function CancelForm({ businessId, busy, onBack, onConfirm }: {
  businessId: number;
  busy: boolean;
  onBack: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const reasons = useQuery({
    queryKey: ["cancel-reasons", businessId],
    queryFn: () => api<CancelReason[]>(`/businesses/${businessId}/cancel-reasons`),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const reason = picked === OTHER ? other.trim() || null : picked;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="mb-2 text-sm font-medium">{t("Bekor qilish sababi")}</p>
      {reasons.isLoading && <Spinner />}
      <div className="flex flex-wrap gap-2">
        {[...(reasons.data ?? []).map((r) => r.name), OTHER].map((name) => (
          <button key={name} type="button" onClick={() => setPicked(name)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${picked === name
                    ? "border-primary bg-primary text-white" : "border-line hover:bg-page"}`}>
            {name === OTHER ? t("O'z sababim...") : dyn(name)}
          </button>
        ))}
      </div>
      {picked === OTHER && (
        <input className={`${inputClass} mt-3`} maxLength={300} autoFocus value={other}
               placeholder={t("Sababni yozing")} onChange={(e) => setOther(e.target.value)} />
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="danger" disabled={busy || !picked || (picked === OTHER && !reason)}
                onClick={() => onConfirm(reason)}>
          {t("Ha, bekor qilish")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onBack}>{t("Orqaga")}</Button>
      </div>
    </div>
  );
}
