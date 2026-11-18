// Bronlarim va Profil (kirgan foydalanuvchi uchun; mehmonga kirish taklif qilinadi).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, LogOut, MapPin, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api, ApiError, Appointment } from "../api";
import { useAuth } from "../auth";
import { btn, ErrorText, Spinner } from "../components/ui";
import { dateLong, money, timeOf } from "../util";
import { t } from "../i18n";

const STATUS: Record<Appointment["status"], [string, string]> = {
  pending: [t("Tasdiq kutilmoqda"), "bg-amber-100 text-amber-800"],
  confirmed: [t("Tasdiqlangan"), "bg-brand-soft text-brand"],
  in_progress: [t("Jarayonda"), "bg-brand-soft text-brand"],
  completed: [t("Yakunlangan"), "bg-emerald-100 text-ok"],
  cancelled: [t("Bekor qilingan"), "bg-red-100 text-hot"],
  no_show: [t("Kelinmadi"), "bg-red-100 text-hot"],
};

function Guest({ text }: { text: string }) {
  const { requireAuth } = useAuth();
  useEffect(() => { requireAuth(text); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <CalendarDays size={40} className="mx-auto text-brand" />
      <h1 className="mt-4 text-2xl font-extrabold">{t("Profilingizga kiring")}</h1>
      <p className="mt-2 text-muted">{text}</p>
      <button onClick={() => requireAuth(text)} className={`${btn.primary} mt-6`}>{t("Kirish yoki ro'yxatdan o'tish")}</button>
    </div>
  );
}

export function Bookings() {
  const { me, ready } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"next" | "past">("next");
  const q = useQuery({ queryKey: ["mine", me?.user.id], enabled: !!me, queryFn: () => api<Appointment[]>("/appointments/mine?upcoming=false") });
  if (!ready) return <div className="flex justify-center py-32"><Spinner /></div>;
  if (!me) return <Guest text={t("Bronlaringizni ko'rish va boshqarish uchun profilingizga kiring")} />;

  const now = Date.now();
  const list = (q.data ?? []).filter((a) => tab === "next"
    ? ["pending", "confirmed", "in_progress"].includes(a.status) && new Date(a.ends_at).getTime() > now
    : !(["pending", "confirmed", "in_progress"].includes(a.status) && new Date(a.ends_at).getTime() > now));
  const cancel = async (a: Appointment) => {
    if (!window.confirm(t("Bronni bekor qilasizmi?"))) return;
    await api(`/appointments/${a.id}/cancel`, { method: "POST", body: {} }).catch((e) => window.alert(e instanceof ApiError ? t(e.message) : t("Bajarib bo'lmadi")));
    await qc.invalidateQueries({ queryKey: ["mine"] });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">{t("Bronlarim")}</h1>
      <div className="mt-5 inline-flex rounded-full bg-soft p-1">
        {([["next", t("Kelgusi")], ["past", t("Tarix")]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full px-5 py-2 text-sm font-bold ${tab === k ? "bg-white shadow" : "text-muted"}`}>{l}</button>
        ))}
      </div>
      {q.isLoading ? <div className="flex justify-center py-16"><Spinner /></div> : list.length === 0 ? (
        <div className="mt-8 rounded-3xl bg-soft p-10 text-center">
          <p className="font-bold">{tab === "next" ? t("Kelgusi bron yo'q") : t("Tarix bo'sh")}</p>
          <Link to="/qidiruv" className={`${btn.primary} mt-5`}>{t("Salon topish")}</Link>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {list.map((a) => (
            <div key={a.id} className="rounded-3xl border border-line p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">{dateLong(a.starts_at)}, {timeOf(a.starts_at)}</p>
                  <Link to={a.business_slug ? `/s/${a.business_slug}` : "#"} className="font-semibold text-brand">{a.business_name}</Link>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span>
              </div>
              <p className="mt-2 text-sm text-muted">{a.services.join(", ")} · {a.member_name}</p>
              {a.business_address && <p className="mt-1 flex items-center gap-1 text-sm text-muted"><MapPin size={14} />{a.business_address}</p>}
              <div className="mt-4 flex items-center justify-between">
                <b>{money(a.total_price - (a.discount ?? 0))}</b>
                {tab === "next" && a.status !== "in_progress" && <button onClick={() => cancel(a)} className="text-sm font-bold text-hot">{t("Bekor qilish")}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Profile() {
  const { me, ready, signOut, refresh } = useAuth();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [del, setDel] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (me) setName(me.user.full_name); }, [me]);
  if (!ready) return <div className="flex justify-center py-32"><Spinner /></div>;
  if (!me) return <Guest text={t("Profilingizni ko'rish uchun kiring")} />;

  const save = async () => {
    setError(null);
    try { await api("/auth/me", { method: "PATCH", body: { full_name: name.trim() } }); await refresh(); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    catch (e) { setError(e instanceof ApiError ? t(e.message) : t("Saqlab bo'lmadi")); }
  };
  const remove = async () => {
    setError(null);
    try { await api("/auth/me", { method: "DELETE" }); await signOut(); }
    catch (e) { setError(e instanceof ApiError ? t(e.message) : t("Bajarib bo'lmadi")); }
  };

  return (
    <div className="mx-auto max-w-xl space-y-8 px-4 py-10 sm:px-6">
      <div className="flex items-center gap-4">
        <span className="bg-brand-grad flex h-16 w-16 items-center justify-center rounded-full text-2xl font-extrabold text-white">{(me.user.full_name || "?").slice(0, 1)}</span>
        <div><h1 className="text-2xl font-extrabold">{me.user.full_name || t("Profil")}</h1><p className="text-muted">{me.user.phone}</p></div>
      </div>
      <div className="space-y-3 rounded-3xl border border-line p-6">
        <p className="font-bold">{t("Ism")}</p>
        <input value={name} onChange={(e) => setName(e.target.value)} className="h-12 w-full rounded-full border-2 border-line px-5 font-semibold outline-none focus:border-brand" />
        <button onClick={save} disabled={name.trim().length < 2} className={btn.primary}>{saved ? t("Saqlandi ✓") : t("Saqlash")}</button>
      </div>
      <button onClick={() => void signOut()} className={`${btn.outline} w-full`}><LogOut size={18} /> {t("Chiqish")}</button>
      {me.workspace === "client" && (
        <div className="space-y-3 rounded-3xl border border-red-200 bg-red-50/50 p-6">
          <p className="flex items-center gap-2 font-bold text-hot"><Trash2 size={18} /> {t("Hisobni o'chirish")}</p>
          <p className="text-sm text-muted">{t("Shaxsiy ma'lumotlar o'chadi, kelgusi bronlar bekor qilinadi. Qaytarib bo'lmaydi.")} <a href="/hisobni-ochirish" className="text-brand underline">{t("Batafsil")}</a></p>
          <input value={del} onChange={(e) => setDel(e.target.value)} placeholder={t("Tasdiqlash uchun {a} deb yozing", { a: t("O'CHIRISH") })}
            className="h-12 w-full rounded-full border-2 border-line bg-white px-5 font-semibold uppercase outline-none focus:border-hot" />
          <button onClick={remove} disabled={del.trim().toUpperCase() !== t("O'CHIRISH")} className="inline-flex h-12 items-center rounded-full bg-hot px-6 font-bold text-white disabled:opacity-40">{t("Hisobni butunlay o'chirish")}</button>
        </div>
      )}
      <ErrorText text={error} />
    </div>
  );
}
