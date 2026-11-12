// Chek: xizmatlar bo'limlar bo'yicha, har birida ijrochi. Chop etishda aynan shu ko'rinish alohida ramkaga
// ko'chiriladi (80 mm lentali printerga ham, oddiy A4 ga ham sig'adi) — shuning uchun uslublar inline.
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useRef, type CSSProperties } from "react";

import { api } from "../../api/client";
import type { Receipt } from "../../api/types";
import { formatDate, formatMoney, formatTime, METHOD_LABELS } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Button, ErrorNote, Spinner } from "../../components/ui";
import { pick, t } from "../../i18n";
import { useVocab } from "../vocab";

const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12 };
const rule: CSSProperties = { borderTop: "1px dashed #000", margin: "8px 0" };
const small: CSSProperties = { fontSize: 11, color: "#444" };

const PRINT_CSS = `
  @page { margin: 6mm; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; }
  .receipt { width: 72mm; max-width: 100%; margin: 0 auto; }
`;

function print(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Chek</title><style>${PRINT_CSS}</style></head>` +
            `<body><div class="receipt">${html}</div></body></html>`);
  doc.close();
  const win = frame.contentWindow!;
  win.onafterprint = () => frame.remove();
  win.focus();
  win.print();
  setTimeout(() => frame.remove(), 60_000);       // onafterprint ishlamaydigan brauzerlar uchun
}

export function ReceiptDialog({ businessId, appointmentId, onClose }: {
  businessId: number;
  appointmentId: number;
  onClose: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ["receipt", businessId, appointmentId],
    queryFn: () => api<Receipt>(`/businesses/${businessId}/appointments/${appointmentId}/receipt`),
    gcTime: 0,                                      // har ochilganda yangi: to'lov qo'shilgan bo'lishi mumkin
  });

  return (
    <Modal title={t("Chek")} onClose={onClose}>
      {query.isPending && <Spinner />}
      {query.error && <ErrorNote error={query.error} />}
      {query.data && (
        <>
          <div className="mx-auto max-w-xs rounded-lg border border-line bg-white p-4 text-[12px] text-black">
            <div ref={body}><ReceiptBody r={query.data} /></div>
          </div>
          <div className="mt-4 flex justify-center">
            <Button className="flex items-center gap-2" data-autofocus
              onClick={() => body.current && print(body.current.innerHTML)}>
              <Printer size={16} aria-hidden /> {t("Chop etish")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ReceiptBody({ r }: { r: Receipt }) {
  const v = useVocab();
  return (
    <div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{r.business_name}</div>
        {r.business_address && <div style={small}>{r.business_address}</div>}
        {r.business_phone && <div style={small}>{r.business_phone}</div>}
      </div>
      <div style={rule} />
      <div style={row}><span>{t("Chek")} № {r.appointment_id}</span><span>{formatDate(r.printed_at)} {formatTime(r.printed_at)}</span></div>
      {r.client_name && <div style={row}><span>{v.clientOne}</span><span style={{ textAlign: "right" }}>{r.client_name}</span></div>}
      <div style={row}><span>{t("Tashrif")}</span><span>{formatDate(r.starts_at)} {formatTime(r.starts_at)}</span></div>

      {r.sections.map((s) => (
        <div key={s.category_id ?? 0}>
          <div style={rule} />
          <div style={{ ...row, fontWeight: 700 }}>
            <span>{s.name ? pick(s.name, s.name_ru) : t("Boshqa xizmatlar")}</span>
            <span>{formatMoney(s.subtotal)}</span>
          </div>
          {s.lines.map((l) => (
            <div key={l.id} style={{ marginTop: 4 }}>
              <div style={row}>
                <span>{pick(l.service_name, l.service_name_ru)}</span>
                <span style={{ whiteSpace: "nowrap" }}>{formatMoney(l.price)}</span>
              </div>
              <div style={small}>{l.house ? t("Muassasa hisobiga") : l.member_name}</div>
            </div>
          ))}
        </div>
      ))}

      <div style={rule} />
      {r.discount > 0 && (
        <>
          <div style={row}><span>{t("Summa")}</span><span>{formatMoney(r.subtotal)}</span></div>
          <div style={row}><span>{t("Chegirma")}</span><span>−{formatMoney(r.discount)}</span></div>
        </>
      )}
      <div style={{ ...row, fontSize: 14, fontWeight: 700 }}><span>{t("Jami")}</span><span>{formatMoney(r.total)}</span></div>
      {r.payments.map((p, i) => (
        <div key={i} style={row}>
          <span>{t("To'landi")} ({METHOD_LABELS[p.method] ?? p.method})</span><span>{formatMoney(p.amount)}</span>
        </div>
      ))}
      {r.due > 0 && <div style={{ ...row, fontWeight: 700 }}><span>{t("Qolgan qarz")}</span><span>{formatMoney(r.due)}</span></div>}
      <div style={rule} />
      <div style={{ textAlign: "center", ...small }}>{t("Tashrifingiz uchun rahmat!")}</div>
    </div>
  );
}
