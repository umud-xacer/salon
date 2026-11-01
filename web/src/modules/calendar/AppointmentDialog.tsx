import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { Appointment, Membership } from "../../api/types";
import { formatDate, formatMoney, formatTime, STATUS_LABELS } from "../../components/format";
import { Button, ErrorNote } from "../../components/ui";
import { Modal } from "../../components/Modal";

const OPEN = ["pending", "confirmed"];

export function AppointmentDialog({ membership, appointment: a, masterName, onClose }: {
  membership: Membership;
  appointment: Appointment;
  masterName: string;
  onClose: () => void;
}) {
  const b = membership.business_id;
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const canManage = membership.permissions.includes("appointments.manage");

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
    <Modal title={a.client_name ?? "Mijoz"} onClose={onClose}>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted">Vaqt</dt>
        <dd className="tabular-nums">
          {formatDate(a.starts_at)}, {formatTime(a.starts_at)}–{formatTime(a.ends_at)}
        </dd>
        <dt className="text-muted">Xizmat</dt>
        <dd>{a.services.join(", ")}</dd>
        <dt className="text-muted">Usta</dt>
        <dd>{masterName}</dd>
        <dt className="text-muted">Narx</dt>
        <dd>{formatMoney(a.total_price)}</dd>
        {a.client_phone && (
          <>
            <dt className="text-muted">Telefon</dt>
            <dd>
              <a className="text-primary" href={`tel:${a.client_phone}`}>
                {a.client_phone}
              </a>
            </dd>
          </>
        )}
        <dt className="text-muted">Holat</dt>
        <dd>{STATUS_LABELS[a.status] ?? a.status}</dd>
      </dl>

      {(setStatus.error || cancel.error) && (
        <div className="mt-3">
          <ErrorNote error={setStatus.error ?? cancel.error} />
        </div>
      )}

      {canManage && (OPEN.includes(a.status) || a.status === "in_progress") && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          {a.status === "pending" && (
            <Button disabled={busy} onClick={() => setStatus.mutate("confirmed")}>
              Tasdiqlash
            </Button>
          )}
          {OPEN.includes(a.status) && (
            <>
              <Button disabled={busy} variant="secondary" onClick={() => setStatus.mutate("in_progress")}>
                Mijoz keldi
              </Button>
              <Button disabled={busy} variant="secondary" onClick={() => setStatus.mutate("no_show")}>
                Kelmadi
              </Button>
              {confirmCancel ? (
                <Button disabled={busy} variant="danger" onClick={() => cancel.mutate()}>
                  Ha, bekor qilish
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                  Bekor qilish
                </Button>
              )}
            </>
          )}
          {a.status === "in_progress" && (
            <Button disabled={busy} onClick={() => setStatus.mutate("completed")}>
              Yakunlash
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
