import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { Appointment, Membership } from "../../api/types";
import { formatDate, formatMoney, formatTime, STATUS_LABELS } from "../../components/format";
import { Button, ErrorNote } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { PaymentPanel } from "../finance/PaymentPanel";
import { useVocab } from "../vocab";
import { VisitPanel } from "./VisitPanel";

import { pickList, t } from "../../i18n";
const OPEN = ["pending", "confirmed"];

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
    onClose();
  };
  const setStatus = useMutation({
    mutationFn: (status: string) =>
      api(`/businesses/${b}/appointments/${a.id}/status`, json("PATCH", { status })),
    onSuccess: done,
  });
  const cancel = useMutation({
    mutationFn: () => api(`/appointments/${a.id}/cancel`, json("POST", {})),
    onSuccess: done,
  });
  const busy = setStatus.isPending || cancel.isPending;

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
        <dd>{STATUS_LABELS[a.status] ?? a.status}</dd>
        {a.cancel_reason && a.status === "cancelled" && <><dt className="text-muted">{t("Sabab")}</dt><dd className="break-words">{a.cancel_reason}</dd></>}
      </dl>

      {a.status === "pending" && a.confirm_by && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("{a} ilovadan bron qildi. {b} {c} gacha tasdiqlanmasa, bron avtomatik bekor qilinadi va vaqt bo'shaydi.", { a: v.clientOne, b: formatDate(a.confirm_by), c: formatTime(a.confirm_by) })}
        </p>
      )}

      {showLines && <VisitPanel membership={membership} appointmentId={a.id} />}
      {showPayments && <PaymentPanel membership={membership} appointmentId={a.id} />}

      {(setStatus.error || cancel.error) && (
        <div className="mt-3">
          <ErrorNote error={setStatus.error ?? cancel.error} />
        </div>
      )}

      {canManage && (OPEN.includes(a.status) || a.status === "in_progress") && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          {a.status === "pending" && (
            <Button disabled={busy} onClick={() => setStatus.mutate("confirmed")}>
              {t("Tasdiqlash")}
            </Button>
          )}
          {OPEN.includes(a.status) && (
            <>
              <Button disabled={busy} variant="secondary" onClick={() => setStatus.mutate("in_progress")}>
                {t("{a} keldi", { a: v.clientOne })}
              </Button>
              <Button disabled={busy} variant="secondary" onClick={() => setStatus.mutate("no_show")}>
                {t("Kelmadi")}
              </Button>
              {confirmCancel ? (
                <Button disabled={busy} variant="danger" onClick={() => cancel.mutate()}>
                  {t("Ha, bekor qilish")}
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                  {t("Bekor qilish")}
                </Button>
              )}
            </>
          )}
          {a.status === "in_progress" && (
            <Button disabled={busy} onClick={() => setStatus.mutate("completed")}>
              {t("Yakunlash")}
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
