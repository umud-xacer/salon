// Avtomatik xabarlar (direktor): tug'ilgan kun tabrigi, tashrifdan keyin sharh so'rash, uzoq kelmagan mijozni qaytarish.
// Xabar ilova hisobi bor mijozga push + Xabarlar bo'limiga, Telegram bog'langan bo'lsa — Telegram'ga ham ketadi.
// "Sinab ko'rish" — saqlangan matn direktorning o'ziga keladi (mijozlarga emas). SMS — ilovasiz mijozlarga,
// server AUTO_SMS_ENABLED bo'lganda (sql/069).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { api, json } from "../../api/client";
import { Button, Card, ErrorNote, inputClass, Spinner } from "../../components/ui";

import { t } from "../../i18n";

type Settings = {
  birthday_enabled: boolean;
  birthday_text: string | null;
  review_enabled: boolean;
  review_delay_hours: number;
  winback_enabled: boolean;
  winback_days: number;
  winback_text: string | null;
  sms_enabled: boolean;
};
type Kind = "birthday" | "review" | "winback";
type Data = { settings: Settings; sent_30d: Record<Kind, number>; sms_available?: boolean };
type TestResult = { title: string; body: string; telegram: boolean };

function Row({ title, hint, on, onToggle, sent, onTest, testing, children }: {
  title: string; hint: string; on: boolean; onToggle: (v: boolean) => void; sent: number;
  onTest: () => void; testing: boolean; children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line p-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span className="flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <span className="whitespace-nowrap text-xs text-muted">{t("30 kunda: {a}", { a: sent })}</span>
      </label>
      {on && children && <div className="mt-3 grid gap-2 pl-7">{children}</div>}
      <div className="mt-2 pl-7">
        <button type="button" onClick={onTest} disabled={testing}
                className="text-xs font-medium text-brand hover:underline disabled:opacity-50">
          {t("Sinab ko'rish — o'zimga yuborish")}
        </button>
      </div>
    </div>
  );
}

export function AutoMessagesCard({ businessId }: { businessId: number }) {
  const queryClient = useQueryClient();
  const key = ["auto-messages", businessId];
  const url = `/businesses/${businessId}/auto-messages`;
  const data = useQuery({ queryKey: key, queryFn: () => api<Data>(url) });
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data.data) setForm(data.data.settings);
  }, [data.data]);

  const save = useMutation({
    mutationFn: (s: Settings) => api<Settings>(url, json("PUT", s)),
    onSuccess: async () => { setSaved(true); await queryClient.invalidateQueries({ queryKey: key }); },
  });

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form) save.mutate(form);
  };
  const sent = data.data?.sent_30d;
  const [tested, setTested] = useState<TestResult | null>(null);
  const test = useMutation({
    mutationFn: (kind: Kind) => api<TestResult>(`${url}/test`, json("POST", { kind })),
    onSuccess: setTested,
  });
  const rowTest = (kind: Kind) => ({ onTest: () => { setTested(null); test.mutate(kind); }, testing: test.isPending });

  return (
    <Card>
      <h2 className="text-sm font-medium">{t("Avtomatik xabarlar")}</h2>
      <p className="mb-3 text-xs text-muted">
        {t("Ilovadagi mijozlarga o'zi yuboriladi: push va Xabarlar bo'limi, Telegram ulangan bo'lsa — Telegram'ga ham. Kunduzi 10:00–20:00 orasida.")}
      </p>
      {data.isPending && <Spinner />}
      {data.error && <ErrorNote error={data.error} />}
      {form && (
        <form onSubmit={submit} className="grid gap-3">
          <Row title={t("Tug'ilgan kun tabrigi")} hint={t("Mijozning tug'ilgan kunida tabrik va sovg'a taklifi")}
               on={form.birthday_enabled} onToggle={(v) => set("birthday_enabled", v)} sent={sent?.birthday ?? 0}
               {...rowTest("birthday")}>
            <textarea className={inputClass} rows={2} maxLength={500} value={form.birthday_text ?? ""}
                      placeholder={t("Masalan: Tug'ilgan kuningiz bilan! Shu hafta barcha xizmatlarga 20% chegirma.")}
                      onChange={(e) => set("birthday_text", e.target.value)} />
          </Row>
          <Row title={t("Tashrifdan keyin sharh so'rash")} hint={t("Rahmat aytib, xizmat va ustani baholashni so'raydi")}
               on={form.review_enabled} onToggle={(v) => set("review_enabled", v)} sent={sent?.review ?? 0}
               {...rowTest("review")}>
            <label className="text-sm">{t("Qachon yuborilsin")}
              <select className={inputClass} value={form.review_delay_hours}
                      onChange={(e) => set("review_delay_hours", Number(e.target.value))}>
                <option value={0}>{t("Xizmat yakunlanishi bilan")}</option>
                {[1, 2, 3, 6, 24].map((h) => <option key={h} value={h}>{t("{a} soatdan keyin", { a: h })}</option>)}
              </select>
            </label>
          </Row>
          <Row title={t("Uzoq kelmagan mijozni qaytarish")} hint={t("Oxirgi tashrifdan keyin belgilangan kun o'tsa va yangi broni bo'lmasa — bir marta eslatma")}
               on={form.winback_enabled} onToggle={(v) => set("winback_enabled", v)} sent={sent?.winback ?? 0}
               {...rowTest("winback")}>
            <label className="text-sm">{t("Necha kundan keyin")}
              <select className={inputClass} value={form.winback_days} onChange={(e) => set("winback_days", Number(e.target.value))}>
                {[30, 45, 60, 90].map((d) => <option key={d} value={d}>{t("{a} kun", { a: d })}</option>)}
              </select>
            </label>
            <textarea className={inputClass} rows={2} maxLength={500} value={form.winback_text ?? ""}
                      placeholder={t("Masalan: Sizni sog'indik! Qaytsangiz — 10% chegirma.")}
                      onChange={(e) => set("winback_text", e.target.value)} />
          </Row>
          {test.error && <ErrorNote error={test.error} />}
          {tested && (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-medium">{t("Sinov xabari sizga yuborildi (ilovadagi Xabarlar bo'limi{a}). Mijozlarga hech narsa ketmadi.",
                                            { a: tested.telegram ? t(" va Telegram") : "" })}</p>
              <p className="mt-1 text-xs"><b>{tested.title}</b> — {tested.body}</p>
              <p className="mt-1 text-xs text-emerald-800">{t("Matnni o'zgartirgan bo'lsangiz, avval \"Saqlash\" ni bosing — sinov saqlangan matn bilan yuboriladi.")}</p>
            </div>
          )}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={form.sms_enabled}
                   onChange={(e) => set("sms_enabled", e.target.checked)} />
            <span className="flex-1">
              <span className="block text-sm font-medium">{t("Ilovasi yo'q mijozlarga SMS orqali")}</span>
              <span className="block text-xs text-muted">
                {data.data?.sms_available
                  ? t("Tug'ilgan kun va qaytarish xabarlari ilovasi yo'q mijozlarga SMS bilan yuboriladi. Sharh so'rash — faqat ilovada.")
                  : t("SMS xizmati hali ulanmagan. Belgilab qo'yishingiz mumkin — SMS yoqilgach o'zi ishlay boshlaydi.")}
              </span>
            </span>
          </label>
          {save.error && <ErrorNote error={save.error} />}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
            {saved && <span className="text-xs text-emerald-700">{t("Saqlandi")}</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
