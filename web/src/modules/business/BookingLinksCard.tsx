// Bron havolasi va QR-kod: butun salon, aniq usta yoki aniq xizmat uchun (Instagram bio, vitrina, vizitka).
// Havola chronix.uz bron sahifasini ochadi: usta tanlangan bo'lsa faqat uning xizmatlari, xizmat ham
// tanlangan bo'lsa to'g'ridan-to'g'ri vaqt tanlash qadami.
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, ExternalLink, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api/client";
import type { ReceptionOptions } from "../../api/types";
import { Button, Card, inputClass } from "../../components/ui";
import { useVocab } from "../vocab";

import { t } from "../../i18n";

const MARKET_URL = "https://chronix.uz";

export function BookingLinksCard({ businessId, slug, listed }: { businessId: number; slug: string; listed: boolean }) {
  const v = useVocab();
  const options = useQuery({
    queryKey: ["reception-options", businessId],
    queryFn: () => api<ReceptionOptions>(`/businesses/${businessId}/reception/options`),
  });
  const [memberId, setMemberId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const staff = options.data?.staff ?? [];
  const member = staff.find((s) => String(s.id) === memberId);
  const services = (options.data?.services ?? []).filter((s) => !member || member.service_ids.includes(s.id));
  const service = services.find((s) => String(s.id) === serviceId);

  const link = useMemo(() => {
    if (!member && !service) return `${MARKET_URL}/s/${slug}`;
    const q = new URLSearchParams();
    if (service) q.set("service", String(service.id));
    if (member) q.set("member", String(member.id));
    return `${MARKET_URL}/s/${slug}/bron?${q}`;
  }, [member, service, slug]);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(link, { width: 512, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0a1650", light: "#ffffff" } })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => { alive = false; };
  }, [link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* brauzer ruxsat bermasa — havola matni ko'rinib turibdi */ }
  };
  const fileName = ["chronix", slug, member?.full_name, service?.name].filter(Boolean).join("-")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-sm font-medium"><QrCode size={16} aria-hidden /> {t("Bron havolasi va QR-kod")}</h2>
      <p className="mb-3 text-xs text-muted">
        {t("Instagram bio, Telegram, vitrina yoki vizitka uchun. Mijoz havolani ochib, darhol bron qiladi.")}
      </p>
      {!listed && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("Havola ishlashi uchun Ma'lumotlar bo'limida \"Ilovada ochiq\" ni yoqing.")}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">{v.staffOne}
              <select className={inputClass} value={memberId} onChange={(e) => { setMemberId(e.target.value); setServiceId(""); }}>
                <option value="">{t("Hammasi (butun salon)")}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </label>
            <label className="block text-sm">{t("Xizmat")}
              <select className={inputClass} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">{t("Mijoz o'zi tanlaydi")}</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div className="rounded-lg border border-line bg-page px-3 py-2 text-sm break-all">{link}</div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="flex items-center gap-1.5" onClick={copy}>
              {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
              {copied ? t("Nusxa olindi") : t("Havolani nusxalash")}
            </Button>
            {qr && (
              <a href={qr} download={`${fileName || "chronix"}-qr.png`}
                 className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm hover:bg-page">
                <Download size={16} aria-hidden /> {t("QR-kodni yuklab olish")}
              </a>
            )}
            <a href={link} target="_blank" rel="noreferrer"
               className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm hover:bg-page">
              <ExternalLink size={16} aria-hidden /> {t("Ochib ko'rish")}
            </a>
          </div>
        </div>
        {qr && <img src={qr} alt={t("QR-kod")} className="mx-auto h-44 w-44 rounded-lg border border-line" />}
      </div>
    </Card>
  );
}
