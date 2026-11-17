// Mijoz segmentlari va ommaviy xabar (056_broadcasts.sql): segmentni tanlash → kimga yetishini ko'rish →
// matn yozish → bir tugma bilan push + Telegram. Spamdan himoya bazada: kuniga 3 ta, bir mijozga 72 soatda 1 ta.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Cake, Crown, Megaphone, Send, Sparkles, UserX, Users, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { Membership } from "../../api/types";
import { formatDate, formatTime } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";

import { t } from "../../i18n";

type Kind = "all" | "inactive" | "birthday" | "regular" | "new";
type Preview = { total: number; with_app: number; telegram: number; without_app: number; sample: string[] };
type Broadcast = {
  id: number; segment: { kind: Kind; param: number; tag: string | null; gender: string | null }; title: string; body: string;
  matched: number; sent_app: number; sent_telegram: number; skipped_recent: number; created_by_name: string | null; created_at: string;
};

const SEGMENTS: { kind: Kind; icon: LucideIcon; label: string; hint: string; params: number[]; paramLabel: (n: number) => string }[] = [
  { kind: "inactive", icon: UserX, label: t("Uzoq kelmaganlar"), hint: t("Oxirgi tashrifdan beri kelmagan, yangi broni yo'q"),
    params: [30, 45, 60, 90, 180], paramLabel: (n) => t("{a} kundan beri", { a: n }) },
  { kind: "birthday", icon: Cake, label: t("Tug'ilgan kuni yaqin"), hint: t("Tug'ilgan kuni yaqin kunlarda"),
    params: [7, 14, 30], paramLabel: (n) => t("{a} kun ichida", { a: n }) },
  { kind: "regular", icon: Crown, label: t("Doimiy mijozlar"), hint: t("Oxirgi 6 oyda bir necha marta kelgan"),
    params: [3, 5, 10], paramLabel: (n) => t("kamida {a} marta", { a: n }) },
  { kind: "new", icon: Sparkles, label: t("Yangi mijozlar"), hint: t("Birinchi marta yaqinda kelgan"),
    params: [30, 60, 90], paramLabel: (n) => t("so'nggi {a} kunda", { a: n }) },
  { kind: "all", icon: Users, label: t("Barcha mijozlar"), hint: t("Bazadagi hamma mijoz"), params: [0], paramLabel: () => "" },
];

export function BroadcastsPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>("inactive");
  const [param, setParam] = useState(30);
  const [gender, setGender] = useState("");
  const [tag, setTag] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [sent, setSent] = useState<Broadcast | null>(null);

  const seg = SEGMENTS.find((x) => x.kind === kind)!;
  const qs = new URLSearchParams({ kind, param: String(param), ...(gender ? { gender } : {}), ...(tag ? { tag } : {}) });
  const preview = useQuery({
    queryKey: ["segment", b, qs.toString()], placeholderData: keepPreviousData,
    queryFn: () => api<Preview>(`/businesses/${b}/segments/preview?${qs}`),
  });
  const tags = useQuery({ queryKey: ["client-tags", b], queryFn: () => api<{ tag: string; count: number }[]>(`/businesses/${b}/clients/tags`) });
  const history = useQuery({ queryKey: ["broadcasts", b], queryFn: () => api<Broadcast[]>(`/businesses/${b}/broadcasts`) });
  const send = useMutation({
    mutationFn: () => api<Broadcast>(`/businesses/${b}/broadcasts`, json("POST", {
      kind, param, gender: gender || null, tag: tag || null, title: title.trim(), body: body.trim(),
    })),
    onSuccess: async (r) => {
      setConfirm(false); setSent(r); setTitle(""); setBody("");
      await queryClient.invalidateQueries({ queryKey: ["broadcasts", b] });
    },
  });

  const pick = (k: Kind) => { setKind(k); setParam(SEGMENTS.find((x) => x.kind === k)!.params[0]); };
  const p = preview.data;
  const ready = title.trim().length >= 2 && body.trim().length >= 2 && (p?.with_app ?? 0) > 0;

  return (
    <>
      <PageTitle title={t("Ommaviy xabar")}
        hint={t("Mijozlar guruhini tanlang va bir tugma bilan xabar yuboring: ilovaga push va Telegram. Kuniga ko'pi bilan 3 ta.")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-medium">{t("1. Kimga")}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {SEGMENTS.map((x) => (
                <button key={x.kind} type="button" onClick={() => pick(x.kind)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${kind === x.kind ? "border-primary bg-primary/5" : "border-line hover:bg-page"}`}>
                  <x.icon size={18} className={kind === x.kind ? "text-primary" : "text-muted"} aria-hidden />
                  <span><span className="block text-sm font-medium">{x.label}</span><span className="block text-xs text-muted">{x.hint}</span></span>
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {seg.params.length > 1 && (
                <label className="block text-sm">{t("Davr")}
                  <select className={inputClass} value={param} onChange={(e) => setParam(Number(e.target.value))}>
                    {seg.params.map((n) => <option key={n} value={n}>{seg.paramLabel(n)}</option>)}
                  </select>
                </label>
              )}
              <label className="block text-sm">{t("Jinsi")}
                <select className={inputClass} value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">{t("Hammasi")}</option>
                  <option value="female">{t("Ayollar")}</option>
                  <option value="male">{t("Erkaklar")}</option>
                </select>
              </label>
              <label className="block text-sm">{t("Teg")}
                <select className={inputClass} value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">{t("Hammasi")}</option>
                  {tags.data?.map((x) => <option key={x.tag} value={x.tag}>{x.tag} ({x.count})</option>)}
                </select>
              </label>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-medium">{t("2. Xabar")}</h2>
            <div className="space-y-3">
              <label className="block text-sm">{t("Sarlavha")}
                <input className={inputClass} maxLength={80} value={title} placeholder={t("Masalan: Sizni sog'indik!")}
                  onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="block text-sm">{t("Matn")}
                <textarea className={inputClass} rows={4} maxLength={500} value={body}
                  placeholder={t("Masalan: Shu hafta barcha xizmatlarga 15% chegirma. Ilovada bron qiling!")}
                  onChange={(e) => setBody(e.target.value)} />
                <span className="text-xs text-muted">{body.length}/500</span>
              </label>
              <Button onClick={() => setConfirm(true)} disabled={!ready}>
                <span className="inline-flex items-center gap-2"><Send size={16} aria-hidden />{t("Yuborish")}</span>
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-medium">{t("Kimga yetadi")}</h2>
            {preview.isPending && <Spinner />}
            {preview.error && <ErrorNote error={preview.error} />}
            {p && (
              <>
                <p className="text-3xl font-semibold tabular-nums text-navy">{p.with_app}</p>
                <p className="text-sm text-muted">{t("mijozga xabar boradi (ilovada hisobi bor)")}</p>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-muted">{t("Segmentda jami")}</dt><dd className="text-right tabular-nums">{p.total}</dd>
                  <dt className="text-muted">{t("Telegram'ga ham")}</dt><dd className="text-right tabular-nums">{p.telegram}</dd>
                  <dt className="text-muted">{t("Ilovasiz (xabar bormaydi)")}</dt><dd className="text-right tabular-nums">{p.without_app}</dd>
                </dl>
                {p.sample.length > 0 && <p className="mt-3 text-xs text-muted">{p.sample.join(", ")}{p.total > p.sample.length ? "…" : ""}</p>}
              </>
            )}
          </Card>
          {(title || body) && (
            <Card>
              <h2 className="mb-2 text-sm font-medium">{t("Mijozda shunday ko'rinadi")}</h2>
              <div className="flex gap-3 rounded-xl bg-page p-3">
                <BellRing size={18} className="mt-0.5 text-primary" aria-hidden />
                <div className="min-w-0"><p className="text-sm font-semibold">{title || "…"}</p><p className="break-words text-sm text-muted">{body || "…"}</p></div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-4">
        <h2 className="mb-2 text-sm font-medium">{t("Yuborilgan xabarlar")}</h2>
        {history.data?.length === 0 && <Empty>{t("Hali ommaviy xabar yuborilmagan")}</Empty>}
        <ul className="divide-y divide-line text-sm">
          {history.data?.map((x) => (
            <li key={x.id} className="py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{x.title}</span>
                <span className="text-xs text-muted">{formatDate(x.created_at)} {formatTime(x.created_at)} · {x.created_by_name ?? ""}</span>
              </div>
              <p className="break-words text-muted">{x.body}</p>
              <p className="text-xs text-muted">
                {SEGMENTS.find((s) => s.kind === x.segment.kind)?.label} · {t("{a} ta yuborildi, Telegram {b}", { a: x.sent_app, b: x.sent_telegram })}
                {x.skipped_recent > 0 && ` · ${t("{a} ta o'tkazildi (yaqinda xabar olgan)", { a: x.skipped_recent })}`}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      {confirm && p && (
        <Modal title={t("Xabarni yuborish")} onClose={() => setConfirm(false)}>
          <p className="text-sm">{t("{a} ta mijozga yuboriladi. Yuborilgan xabarni qaytarib bo'lmaydi.", { a: p.with_app })}</p>
          <p className="mt-2 text-xs text-muted">{t("Oxirgi 3 kunda xabar olgan mijozlar o'tkazib yuboriladi.")}</p>
          {send.error && <div className="mt-3"><ErrorNote error={send.error} /></div>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(false)}>{t("Bekor qilish")}</Button>
            <Button onClick={() => send.mutate()} disabled={send.isPending}>{t("Yuborish")}</Button>
          </div>
        </Modal>
      )}
      {sent && (
        <Modal title={t("Yuborildi")} onClose={() => setSent(null)}>
          <p className="flex items-center gap-2 text-sm"><Megaphone size={16} className="text-primary" aria-hidden />
            {t("{a} ta mijozga yuborildi, Telegram'ga {b} ta.", { a: sent.sent_app, b: sent.sent_telegram })}</p>
          {sent.skipped_recent > 0 && <p className="mt-2 text-xs text-muted">{t("{a} ta o'tkazildi (yaqinda xabar olgan)", { a: sent.skipped_recent })}</p>}
          <div className="mt-4 flex justify-end"><Button onClick={() => setSent(null)}>{t("Yaxshi")}</Button></div>
        </Modal>
      )}
    </>
  );
}
