// "Skanerlash" oynasi: kamera -> kod bo'yicha qidiruv -> topilsa kirim/chiqim, topilmasa tezkor qo'shish.
// Bir amal tugagach yana skaner ochiladi — ketma-ket bir nechta mahsulotni o'tkazish uchun.
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ScanLine } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import type { Product } from "../../api/types";
import { BarcodeScanner } from "../../components/BarcodeScanner";
import { formatMoney, formatQty } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, ErrorNote, inputClass, Spinner, Tabs } from "../../components/ui";
import { t } from "../../i18n";
import { createScanned, findByBarcode, moveStock, normalizeBarcode, type QuickMove } from "./barcode";

type Step =
  | { at: "scan" }
  | { at: "found"; product: Product }
  | { at: "missing"; code: string };

export function ScanDialog({ businessId, canManage, onChanged, onEdit, onClose }: {
  businessId: number;
  canManage: boolean;
  onChanged: () => Promise<unknown>;      // ro'yxat va yig'indilarni yangilash
  onEdit: (p: Product) => void;           // to'liq tahrirlash oynasi
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ at: "scan" });
  const [manual, setManual] = useState("");
  const [badCode, setBadCode] = useState(false);
  const [done, setDone] = useState("");       // oxirgi bajarilgan amal xabari

  const lookup = useMutation({
    mutationFn: (code: string) => findByBarcode(businessId, code).then((product) => ({ code, product })),
    onSuccess: ({ code, product }) => setStep(product ? { at: "found", product } : { at: "missing", code }),
  });
  // Amal tugagach kamera hali o'sha mahsulotga qarab turadi — shu kod bir necha soniya qayta ochilmasin
  const justDone = useRef({ code: "", until: 0 });
  const search = (raw: string, fromCamera = false) => {
    if (lookup.isPending) return;
    const code = normalizeBarcode(raw);
    if (fromCamera && code && code === justDone.current.code && Date.now() < justDone.current.until) return;
    setBadCode(!code);
    if (!code) return;
    setDone("");
    lookup.mutate(code);
  };
  const again = (message = "") => {
    const code = step.at === "found" ? step.product.barcode ?? "" : step.at === "missing" ? step.code : "";
    justDone.current = { code, until: Date.now() + 4000 };
    setDone(message);
    setManual("");
    lookup.reset();
    setStep({ at: "scan" });
  };
  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    search(manual);
  };

  return (
    <Modal title={t("Shtrix-kodni skanerlash")} onClose={onClose}>
      {step.at === "scan" && (
        <div className="space-y-3">
          {done && (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm text-success">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> <span>{done}</span>
            </p>
          )}
          {lookup.isPending ? <Spinner /> : <BarcodeScanner onDetected={(text) => search(text, true)} />}
          {badCode && (
            <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
              {t("Bu kod mahsulot shtrix-kodi emas (4–64 ta harf yoki raqam bo'lishi kerak). Boshqasini o'qiting.")}
            </p>
          )}
          {lookup.error && <ErrorNote error={lookup.error} />}
          <form onSubmit={submitManual} className="flex items-end gap-2">
            <label className="block min-w-0 flex-1 text-sm">{t("Yoki kodni qo'lda kiriting (USB skaner ham shu yerga yozadi)")}
              <input className={`${inputClass} font-mono`} inputMode="numeric" maxLength={64} autoComplete="off"
                value={manual} onChange={(e) => setManual(e.target.value)} />
            </label>
            <Button type="submit" variant="secondary" disabled={!manual.trim() || lookup.isPending}>{t("Qidirish")}</Button>
          </form>
        </div>
      )}
      {step.at === "found" && (
        <Found businessId={businessId} product={step.product} canManage={canManage} onChanged={onChanged}
          onDone={again} onEdit={() => { onEdit(step.product); }} />
      )}
      {step.at === "missing" && (
        <Missing businessId={businessId} code={step.code} canManage={canManage} onChanged={onChanged} onDone={again} />
      )}
    </Modal>
  );
}

function RescanButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" className="flex items-center gap-1" onClick={onClick}>
      <ScanLine size={16} aria-hidden /> {t("Yana skanerlash")}
    </Button>
  );
}

function Found({ businessId, product: p, canManage, onChanged, onDone, onEdit }: {
  businessId: number;
  product: Product;
  canManage: boolean;
  onChanged: () => Promise<unknown>;
  onDone: (message?: string) => void;
  onEdit: () => void;
}) {
  const [kind, setKind] = useState<QuickMove>("purchase");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState(String(p.cost_price));

  const save = useMutation({
    mutationFn: () => moveStock(businessId, p, kind, Number(qty), Number(cost)),
    onSuccess: async (updated) => {
      await onChanged();
      const change = `${kind === "purchase" ? "+" : "−"}${formatQty(Number(qty))} ${p.unit}`;
      onDone(t("{a}: {b}. Qoldiq: {c} {d}", { a: p.name, b: change, c: formatQty(updated.current_qty), d: p.unit }));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line p-4">
        <p className="text-lg font-semibold break-words text-navy">{p.name}</p>
        <p className="font-mono text-xs text-muted">{p.barcode}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">{t("Sotuv narx")}</dt>
            <dd className="text-base font-semibold tabular-nums">{formatMoney(p.sale_price)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t("Qoldiq")}</dt>
            <dd className="text-base font-semibold tabular-nums">
              {formatQty(p.current_qty)} {p.unit} {p.is_low && <Badge tone="amber">{t("Kam qoldi")}</Badge>}
            </dd>
          </div>
        </dl>
      </div>
      {!p.is_active && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
          {t("Bu mahsulot yashirilgan. Kirim-chiqim qilish uchun avval uni tahrirlab, faol qiling.")}
        </p>
      )}
      {canManage && p.is_active && (
        <form onSubmit={submit} className="space-y-3">
          <Tabs<QuickMove>
            value={kind}
            onChange={setKind}
            tabs={[{ id: "purchase", label: t("Kirim") }, { id: "usage", label: t("Ombordan kamaytirish") }]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">{t("Miqdor ({a})", { a: p.unit })}
              <input className={inputClass} type="number" inputMode="decimal" required data-autofocus min={0.001} step={0.001}
                max={kind === "usage" ? p.current_qty : undefined} value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            {kind === "purchase" && (
              <label className="block text-sm">{t("Bir birlik narxi")}
                <input className={inputClass} type="number" inputMode="numeric" required min={0} step={1} value={cost}
                  onChange={(e) => setCost(e.target.value)} />
              </label>
            )}
          </div>
          {save.error && <ErrorNote error={save.error} />}
          <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
        </form>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <RescanButton onClick={() => onDone()} />
        {canManage && <Button type="button" variant="secondary" onClick={onEdit}>{t("Tahrirlash")}</Button>}
      </div>
    </div>
  );
}

function Missing({ businessId, code, canManage, onChanged, onDone }: {
  businessId: number;
  code: string;
  canManage: boolean;
  onChanged: () => Promise<unknown>;
  onDone: (message?: string) => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("dona");
  const [cost, setCost] = useState("0");
  const [sale, setSale] = useState("");
  const [qty, setQty] = useState("1");

  const save = useMutation({
    mutationFn: () => createScanned(businessId, {
      barcode: code, name: name.trim(), unit: unit.trim(), cost_price: Number(cost), sale_price: Number(sale),
      initial_qty: Number(qty),
    }),
    onSuccess: async (created) => {
      await onChanged();
      onDone(t("{a} qo'shildi. Qoldiq: {b} {c}", { a: created.name, b: formatQty(created.current_qty), c: created.unit }));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  if (!canManage) {
    return (
      <div className="space-y-3">
        <p className="text-sm">{t("Bu kod bazada yo'q: {a}", { a: code })}</p>
        <RescanButton onClick={() => onDone()} />
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="rounded-xl bg-primary/5 px-4 py-3">
        <p className="font-semibold text-navy">{t("Yangi mahsulot topildi, bazaga qo'shasizmi?")}</p>
        <p className="font-mono text-sm text-muted">{code}</p>
      </div>
      <label className="block text-sm">{t("Nomi")}
        <input className={inputClass} required data-autofocus autoFocus minLength={2} maxLength={120} value={name}
          onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{t("Sotuv narxi")}
          <input className={inputClass} type="number" inputMode="numeric" required min={0} step={1} value={sale}
            onChange={(e) => setSale(e.target.value)} />
        </label>
        <label className="block text-sm">{t("Tan narxi")}
          <input className={inputClass} type="number" inputMode="numeric" required min={0} step={1} value={cost}
            onChange={(e) => setCost(e.target.value)} />
        </label>
        <label className="block text-sm">{t("Miqdor (hozir omborda)")}
          <input className={inputClass} type="number" inputMode="decimal" required min={0} step={0.001} value={qty}
            onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="block text-sm">{t("O'lchov birligi")}
          <input className={inputClass} required maxLength={20} list="scan-units" value={unit}
            onChange={(e) => setUnit(e.target.value)} />
          <datalist id="scan-units">
            {["dona", "ml", "l", "g", "kg", "quti"].map((u) => <option key={u} value={u} />)}
          </datalist>
        </label>
      </div>
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>{t("Ha, qo'shish")}</Button>
        <Button type="button" variant="secondary" onClick={() => onDone()}>{t("Yo'q, qayta skanerlash")}</Button>
      </div>
    </form>
  );
}
