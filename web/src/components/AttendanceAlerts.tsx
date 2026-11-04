// "Mijoz bilan bog'laning!" — mijoz bronni tasdiqlamasa, vaqtiga 20 daqiqa qolganda server yuboradi.
// Panel har 20 soniyada tekshiradi, yangisi bo'lsa ovoz bilan oyna chiqaradi: qo'ng'iroq, bronni bekor qilish, yopish.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Phone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, ApiError, json } from "../api/client";
import { formatTime } from "./format";
import { Button } from "./ui";

interface Alert {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: { appointment_id: number; client_name?: string; starts_at?: string; master?: string } | null;
  created_at: string;
}

const KEY = ["attendance-alerts"];

// Qisqa signal (brauzer ruxsat bermasa — jim)
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.3);
    });
  } catch {
    // ovozsiz davom etadi
  }
}

export function AttendanceAlerts() {
  const alerts = useQuery({
    queryKey: KEY,
    queryFn: async () => (await api<Alert[]>("/notifications?unread=true&limit=50")).filter((n) => n.type === "attendance_alert"),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  const seen = useRef(new Set<number>());

  useEffect(() => {
    const fresh = (alerts.data ?? []).filter((a) => !seen.current.has(a.id));
    if (fresh.length === 0) return;
    fresh.forEach((a) => seen.current.add(a.id));
    beep();
    if ("Notification" in window && Notification.permission === "granted") {
      fresh.forEach((a) => new Notification(a.title, { body: a.body ?? "", tag: `alert-${a.id}` }));
    }
  }, [alerts.data]);

  const list = alerts.data ?? [];
  if (list.length === 0) return null;
  return (
    <div className="fixed right-3 bottom-3 z-[1100] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2" role="region"
      aria-label="Ogohlantirishlar" aria-live="assertive">
      {list.slice(0, 3).map((a) => <AlertCard key={a.id} alert={a} />)}
      {list.length > 3 && <p className="rounded-lg bg-white px-3 py-1.5 text-center text-xs shadow">yana {list.length - 3} ta</p>}
    </div>
  );
}

function AlertCard({ alert: a }: { alert: Alert }) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const appointmentId = a.data?.appointment_id;
  const close = useMutation({
    mutationFn: () => api(`/notifications/${a.id}/read`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/appointments/${appointmentId}/cancel`, json("POST", { reason: "Mijoz bilan bog'lanib bo'lmadi" })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
      close.mutate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Bekor qilib bo'lmadi"),
  });
  const showPhone = async () => {
    setError(null);
    try {
      const r = await api<{ phone: string }>(`/appointments/${appointmentId}/client-contact`);
      setPhone(r.phone);
    } catch (e) {
      // Mijoz shu orada tasdiqlagan yoki bron bekor bo'lgan
      setError(e instanceof ApiError ? "Ogohlantirish yopilgan: mijoz tasdiqlagan yoki bron o'zgargan" : "Xatolik");
    }
  };

  return (
    <div role="alertdialog" aria-labelledby={`alert-${a.id}`}
      className="rounded-xl border-2 border-danger bg-white p-3 text-sm shadow-xl">
      <div className="flex items-start gap-2">
        <BellRing size={20} className="mt-0.5 shrink-0 animate-pulse text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <p id={`alert-${a.id}`} className="font-semibold text-danger">{a.title}</p>
          <p className="mt-0.5 break-words">{a.body}</p>
          {(a.data?.master || a.data?.starts_at) && (
            <p className="mt-0.5 text-xs text-muted">
              {a.data?.starts_at && `Bron: ${formatTime(a.data.starts_at)}`}{a.data?.master && ` · Usta: ${a.data.master}`}
            </p>
          )}
        </div>
        <button type="button" aria-label="Yopish" onClick={() => close.mutate()} className="text-muted hover:text-ink">
          <X size={18} />
        </button>
      </div>
      {phone && (
        <p className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-page px-3 py-2">
          <span className="font-mono tabular-nums select-all">{phone}</span>
          <a href={`tel:${phone}`} className="inline-flex items-center gap-1 rounded-lg bg-success px-3 py-1.5 font-medium text-white">
            <Phone size={15} aria-hidden /> Qo'ng'iroq qilish
          </a>
        </p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {!phone && (
          <Button className="flex items-center gap-1" onClick={() => void showPhone()} disabled={!appointmentId}>
            <Phone size={15} aria-hidden /> Qo'ng'iroq qilish
          </Button>
        )}
        <Button variant="danger" disabled={!appointmentId || cancel.isPending} onClick={() => cancel.mutate()}>
          Bronni bekor qilish
        </Button>
        <Button variant="secondary" disabled={close.isPending} onClick={() => close.mutate()}>Yopish</Button>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        Bekor qilinsa, vaqt boshqa mijozlar uchun darhol ochiladi. Mijoz kelmasa — kalendarda "Kelmadi" deb belgilang.
      </p>
    </div>
  );
}
