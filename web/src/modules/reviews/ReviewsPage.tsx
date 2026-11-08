// Baholar: direktor mijozlar qo'ygan baholar va izohlarni ko'radi, javob yozadi.
// Usta / shifokor esa "Baholarim" da o'ziga qo'yilganlarini ko'radi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareReply } from "lucide-react";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { BusinessReview, Membership, ReviewsPage as ReviewsData, ReviewSummary } from "../../api/types";
import { formatDate } from "../../components/format";
import { ratingText, Stars } from "../../components/Stars";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner, Tabs } from "../../components/ui";
import { useVocab } from "../vocab";

import { t } from "../../i18n";
type Filter = "all" | "unanswered" | "low";

export function ReviewsPage({ membership }: { membership: Membership }) {
  const v = useVocab();
  const b = membership.business_id;
  const [filter, setFilter] = useState<Filter>("all");
  const params = new URLSearchParams({ limit: "200" });
  if (filter === "unanswered") params.set("unanswered", "true");
  const q = useQuery({
    queryKey: ["reviews", b, filter],
    queryFn: () => api<ReviewsData>(`/businesses/${b}/reviews?${params}`),
  });
  const items = (q.data?.items ?? []).filter((r) => filter !== "low" || r.rating <= 3);

  return (
    <div className="space-y-4">
      <PageTitle title={t("Baholar")} hint={t("Faqat xizmatdan foydalangan (yakunlangan tashrif) {a} baho qo'ya oladi.", { a: v.clients.toLowerCase() })} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
        <>
          <SummaryCard s={q.data!.summary} criteria />
          <Tabs tabs={[{ id: "all", label: t("Hammasi") }, { id: "unanswered", label: t("Javobsiz") }, { id: "low", label: t("3 va past") }]}
            value={filter} onChange={setFilter} />
          {items.length === 0 ? <Empty>{t("Hozircha baho yo'q")}</Empty> : (
            <ul className="space-y-3">
              {items.map((r) => <ReviewItem key={r.id} r={r} businessId={b} staffWord={v.staffOne} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function MyReviewsPage({ membership }: { membership: Membership }) {
  const v = useVocab();
  const b = membership.business_id;
  const q = useQuery({ queryKey: ["reviews", b, "mine"], queryFn: () => api<ReviewsData>(`/businesses/${b}/reviews/mine`) });
  return (
    <div className="space-y-4">
      <PageTitle title={t("Baholarim")} hint={t("{a} sizning ishingizga qo'ygan baholar. Bu reyting ilovada profilingizda ko'rinadi.", { a: v.clients })} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
        <>
          <SummaryCard s={q.data!.summary} />
          {q.data!.items.length === 0 ? <Empty>{t("Hozircha baho yo'q")}</Empty> : (
            <ul className="space-y-3">
              {q.data!.items.map((r) => (
                <li key={r.id}>
                  <Card className="space-y-1 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><Stars value={r.staff_rating} /> <span className="font-medium">{r.author}</span></span>
                      <span className="text-xs text-muted">{formatDate(r.created_at)}</span>
                    </div>
                    {r.staff_comment && <p className="break-words">{r.staff_comment}</p>}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ s, criteria = false }: { s: ReviewSummary; criteria?: boolean }) {
  const max = Math.max(...Object.values(s.distribution), 0);
  return (
    <Card className="grid gap-4 sm:grid-cols-[auto_1fr]">
      <div className="min-w-40">
        <p className="text-3xl font-semibold tabular-nums text-navy">{s.rating_avg ? s.rating_avg.toFixed(1) : "—"}</p>
        <Stars value={s.rating_avg} size={18} />
        <p className="mt-1 text-xs text-muted">{t("{a} ta baho", { a: s.count })}</p>
        {criteria && s.count > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">{t("Tozalik")}</dt><dd className="tabular-nums">{ratingText(s.cleanliness_avg)}</dd>
            <dt className="text-muted">{t("Qabul va xizmat")}</dt><dd className="tabular-nums">{ratingText(s.quality_avg)}</dd>
          </dl>
        )}
      </div>
      <ul className="space-y-1.5 self-center text-sm">
        {[5, 4, 3, 2, 1].map((k) => {
          const n = s.distribution[String(k)] ?? 0;
          return (
            <li key={k} className="grid grid-cols-[2rem_1fr_2.5rem] items-center gap-2">
              <span className="tabular-nums text-muted">{k} ★</span>
              <span className="h-2 rounded bg-page">
                {n > 0 && <span className="block h-2 rounded bg-amber-400" style={{ width: `${(n / max) * 100}%` }} />}
              </span>
              <span className="text-right tabular-nums">{n}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ReviewItem({ r, businessId, staffWord }: { r: BusinessReview; businessId: number; staffWord: string }) {
  const v = useVocab();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.reply ?? "");
  const save = useMutation({
    mutationFn: (reply: string | null) => api(`/businesses/${businessId}/reviews/${r.id}/reply`, json("PUT", { reply })),
    onSuccess: () => {
      setEditing(false);
      return queryClient.invalidateQueries({ queryKey: ["reviews", businessId] });
    },
  });

  return (
    <li>
      <Card className="space-y-2 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <Stars value={r.rating} />
              <span className="font-medium break-words">{r.client_name ?? r.author}</span>
              {r.is_hidden && <Badge tone="gray">{t("Super Admin yashirgan")}</Badge>}
            </p>
            <p className="text-xs text-muted">
              {formatDate(r.created_at)}
              {r.appointment_starts_at && t(" · tashrif {a}", { a: formatDate(r.appointment_starts_at) })}
              {r.client_phone && <> · <a className="hover:underline" href={`tel:${r.client_phone}`}>{r.client_phone}</a></>}
            </p>
          </div>
          <p className="text-xs text-muted">{t("Tozalik {a} · Xizmat {b}", { a: r.cleanliness ?? "—", b: r.service_quality ?? "—" })}</p>
        </div>
        {r.comment && <p className="break-words">{r.comment}</p>}
        {r.staff_rating && (
          <div className="rounded-lg bg-page px-3 py-2">
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">{staffWord}: {r.member_name ?? "—"}</span> <Stars value={r.staff_rating} size={12} />
            </p>
            {r.staff_comment && <p className="mt-1 break-words">{r.staff_comment}</p>}
          </div>
        )}
        {editing ? (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(text.trim() || null); }}>
            <textarea className={`${inputClass} min-h-20`} maxLength={1000} value={text} autoFocus
              placeholder={t("{a}ga javobingiz (ilovada hamma ko'radi)", { a: v.clientOne })} onChange={(e) => setText(e.target.value)} />
            {save.error && <ErrorNote error={save.error} />}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending || !text.trim()}>{t("Javobni saqlash")}</Button>
              {r.reply && <Button type="button" variant="danger" disabled={save.isPending} onClick={() => save.mutate(null)}>{t("Javobni o'chirish")}</Button>}
              <Button type="button" variant="secondary" onClick={() => { setEditing(false); setText(r.reply ?? ""); }}>{t("Bekor")}</Button>
            </div>
          </form>
        ) : r.reply ? (
          <div className="border-l-2 border-primary pl-3">
            <p className="text-xs text-muted">{t("Javobingiz{a}{b}", { a: r.reply_at ? ` · ${formatDate(r.reply_at)}` : "", b: r.replied_by_name ? ` · ${r.replied_by_name}` : "" })}</p>
            <p className="break-words">{r.reply}</p>
            <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setEditing(true)}>{t("Tahrirlash")}</button>
          </div>
        ) : (
          <Button variant="secondary" className="flex items-center gap-1" onClick={() => setEditing(true)}>
            <MessageSquareReply size={15} aria-hidden />{" "}{t("Javob yozish")}
          </Button>
        )}
      </Card>
    </li>
  );
}
