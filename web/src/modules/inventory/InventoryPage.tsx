import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { InventorySummary, Membership, Product, StockMovement } from "../../api/types";
import { formatDate, formatMoney, formatQty, formatTime, MOVE_LABELS } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner, Tabs } from "../../components/ui";
import { vocabFor } from "../vocab";

import { t } from "../../i18n";
const PAGE = 50;
type View = "active" | "low" | "inactive" | "moves";

function useRefreshInventory(businessId: number) {
  const queryClient = useQueryClient();
  return () => Promise.all(
    ["products", "inventory-summary", "stock-moves"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key, businessId] })),
  );
}

export function InventoryPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const canManage = membership.permissions.includes("inventory.manage");
  const [view, setView] = useState<View>("active");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [moving, setMoving] = useState<Product | null>(null);

  useEffect(() => {
    const tx = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(tx);
  }, [text]);

  const summary = useQuery({
    queryKey: ["inventory-summary", b],
    queryFn: () => api<InventorySummary>(`/businesses/${b}/inventory/summary`),
  });
  const low = summary.data?.low_count ?? 0;

  return (
    <>
      <PageTitle
        title={vocabFor(membership.business_kind).inventory}
        hint={summary.data && t("{a} ta mahsulot, jami {b}", { a: summary.data.products, b: formatMoney(summary.data.stock_value) })}
        action={canManage && (
          <Button className="flex items-center gap-1" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden /> {vocabFor(membership.business_kind).product}
          </Button>
        )}
      />
      {low > 0 && view !== "low" && (
        <button onClick={() => setView("low")}
          className="mb-3 flex w-full items-center gap-2 rounded-xl bg-warning/10 px-4 py-3 text-left text-sm text-warning">
          <AlertTriangle size={16} className="shrink-0" aria-hidden />
          <span>{t("{a} ta mahsulot kam qoldi. Ko'rish", { a: low })}</span>
        </button>
      )}
      <Tabs<View>
        value={view}
        onChange={setView}
        tabs={[
          { id: "active", label: t("Mahsulotlar") },
          { id: "low", label: low > 0 ? t("Kam qolgan ({a})", { a: low }) : t("Kam qolgan") },
          { id: "moves", label: t("Harakatlar") },
          { id: "inactive", label: t("Yashirilgan") },
        ]}
      />
      {view === "moves" ? <Movements businessId={b} /> : (
        <>
          <label className="relative mb-3 block">
            <span className="sr-only">{t("Qidirish")}</span>
            <Search size={16} className="absolute top-2.5 left-3 text-muted" aria-hidden />
            <input
              className="w-full rounded-lg border border-line bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-primary"
              placeholder={t("Nomi yoki kodi")}
              maxLength={60}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <ProductList businessId={b} show={view} q={q} canManage={canManage} onEdit={setEditing} onMove={setMoving} />
        </>
      )}
      {editing && (
        <ProductDialog businessId={b} product={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
      {moving && <MoveDialog businessId={b} product={moving} onClose={() => setMoving(null)} />}
    </>
  );
}

function ProductList({ businessId, show, q, canManage, onEdit, onMove }: {
  businessId: number;
  show: Exclude<View, "moves">;
  q: string;
  canManage: boolean;
  onEdit: (p: Product) => void;
  onMove: (p: Product) => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ["products", businessId, show, q],
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => api<Product[]>(
      `/businesses/${businessId}/products?show=${show}&q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${pageParam}`),
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
  });
  const products = query.data?.pages.flat();

  if (query.isPending) return <Spinner />;
  if (query.error) return <ErrorNote error={query.error} />;
  if (!products?.length) {
    const label = q ? t("Topilmadi") : show === "low" ? t("Kam qolgan mahsulot yo'q") : t("Mahsulot yo'q");
    return <Card><Empty>{label}</Empty></Card>;
  }

  return (
    <>
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        <li aria-hidden className="hidden px-4 py-2 text-xs text-muted lg:grid lg:grid-cols-[1fr_8rem_7rem_7rem_7rem] lg:gap-3">
          <span>{t("Mahsulot")}</span>
          <span className="text-right">{t("Qoldiq")}</span>
          <span className="text-right">{t("Tan narx")}</span>
          <span className="text-right">{t("Sotuv narx")}</span>
          <span />
        </li>
        {products.map((p) => (
          <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-sm lg:grid-cols-[1fr_8rem_7rem_7rem_7rem]">
            <button disabled={!canManage} onClick={() => onEdit(p)} className="min-w-0 text-left disabled:cursor-default">
              <span className="block font-medium break-words">{p.name}</span>
              {(p.category || p.sku || p.barcode) && (
                <span className="block text-xs text-muted break-words">
                  {[p.category, p.sku, p.barcode && t("Shtrix-kod: {a}", { a: p.barcode })].filter(Boolean).join(" · ")}
                </span>
              )}
            </button>
            <span className="text-right tabular-nums">
              <span className="block whitespace-nowrap">{formatQty(p.current_qty)} {p.unit}</span>
              {p.is_low && <Badge tone="amber">{t("Kam qoldi")}</Badge>}
            </span>
            <span className="col-span-2 text-xs text-muted tabular-nums lg:hidden">
              {t("Tan narx {a} · Sotuv {b}", { a: formatMoney(p.cost_price), b: formatMoney(p.sale_price) })}
            </span>
            <span className="hidden text-right tabular-nums lg:block">{formatMoney(p.cost_price)}</span>
            <span className="hidden text-right tabular-nums lg:block">{formatMoney(p.sale_price)}</span>
            {canManage && p.is_active && (
              <Button variant="secondary" className="col-span-2 lg:col-span-1" onClick={() => onMove(p)}>
                {t("Kirim-chiqim")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <div className="mt-3 text-center">
          <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t("Yana ko'rsatish")}
          </Button>
        </div>
      )}
    </>
  );
}

function Movements({ businessId }: { businessId: number }) {
  const query = useInfiniteQuery({
    queryKey: ["stock-moves", businessId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<StockMovement[]>(`/businesses/${businessId}/stock-movements?limit=${PAGE}&offset=${pageParam}`),
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
  });
  const moves = query.data?.pages.flat();

  if (query.isPending) return <Spinner />;
  if (query.error) return <ErrorNote error={query.error} />;
  if (!moves?.length) return <Card><Empty>{t("Harakat yo'q")}</Empty></Card>;

  return (
    <>
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {moves.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1 basis-48">
              <span className="block font-medium break-words">{m.product_name}</span>
              <span className="block text-xs text-muted break-words">
                {MOVE_LABELS[m.type] ?? m.type} · {formatDate(m.created_at)} {formatTime(m.created_at)}
                {m.created_by_name && ` · ${m.created_by_name}`}
              </span>
              {m.note && <span className="block text-xs text-muted break-words">{m.note}</span>}
            </span>
            <span className={`whitespace-nowrap tabular-nums ${m.qty > 0 ? "text-success" : "text-danger"}`}>
              {m.qty > 0 ? "+" : "−"}{formatQty(Math.abs(m.qty))} {m.unit}
            </span>
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <div className="mt-3 text-center">
          <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t("Yana ko'rsatish")}
          </Button>
        </div>
      )}
    </>
  );
}

function ProductDialog({ businessId, product, onClose }: {
  businessId: number;
  product: Product | null;
  onClose: () => void;
}) {
  const refresh = useRefreshInventory(businessId);
  const url = `/businesses/${businessId}/products`;
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "dona");
  const [cost, setCost] = useState(String(product?.cost_price ?? 0));
  const [sale, setSale] = useState(String(product?.sale_price ?? 0));
  const [min, setMin] = useState(String(product?.min_qty ?? 0));
  const [active, setActive] = useState(product?.is_active ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), sku: sku.trim() || null, category: category.trim() || null,
                     barcode: barcode.trim() || null, unit: unit.trim(), cost_price: Number(cost),
                     sale_price: Number(sale), min_qty: Number(min) };
      return product
        ? api(`${url}/${product.id}`, json("PUT", { ...body, is_active: active }))
        : api(url, json("POST", body));
    },
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal title={product ? product.name : t("Yangi mahsulot")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">{t("Nomi")}
          <input className={inputClass} required data-autofocus minLength={2} maxLength={120} value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t("Kodi (ixtiyoriy)")}
            <input className={inputClass} maxLength={60} value={sku} onChange={(e) => setSku(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Kategoriya (ilovada guruh)")}
            <input className={inputClass} maxLength={80} placeholder={t("Vitaminlar, og'riq qoldiruvchi...")} value={category}
              onChange={(e) => setCategory(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Shtrix-kod (ixtiyoriy)")}
            <input className={`${inputClass} font-mono`} maxLength={64} pattern="[0-9A-Za-z\-]{4,64}" inputMode="numeric"
              placeholder={t("Skaner bilan o'qiting")} value={barcode} onChange={(e) => setBarcode(e.target.value.trim())} />
          </label>
          <label className="block text-sm">{t("O'lchov birligi")}
            <input className={inputClass} required maxLength={20} list="units" value={unit}
              onChange={(e) => setUnit(e.target.value)} />
            <datalist id="units">
              {["dona", "ml", "l", "g", "kg", "quti"].map((u) => <option key={u} value={u} />)}
            </datalist>
          </label>
          <label className="block text-sm">{t("Tan narxi")}
            <input className={inputClass} type="number" inputMode="numeric" required min={0} step={1} value={cost}
              onChange={(e) => setCost(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Sotuv narxi")}
            <input className={inputClass} type="number" inputMode="numeric" required min={0} step={1} value={sale}
              onChange={(e) => setSale(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">{t("Kam qolish chegarasi")}
          <input className={inputClass} type="number" inputMode="decimal" required min={0} step={0.001} value={min}
            onChange={(e) => setMin(e.target.value)} />
          <span className="mt-1 block text-xs text-muted">{t("0 bo'lsa, ogohlantirilmaydi")}</span>
        </label>
        {product && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t("Faol (o'chirilsa, ro'yxatdan yashiriladi, tarix saqlanadi)")}
          </label>
        )}
        {save.error && <ErrorNote error={save.error} />}
        <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
      </form>
    </Modal>
  );
}

type MoveKind = "purchase" | "usage" | "write_off" | "count";

function MoveDialog({ businessId, product: p, onClose }: {
  businessId: number;
  product: Product;
  onClose: () => void;
}) {
  const refresh = useRefreshInventory(businessId);
  const url = `/businesses/${businessId}/products/${p.id}`;
  const [kind, setKind] = useState<MoveKind>("purchase");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState(String(p.cost_price));
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () => kind === "count"
      ? api(`${url}/count`, json("POST", { counted: Number(qty), note: note.trim() }))
      : api(`${url}/movements`, json("POST", {
          type: kind, qty: Number(qty), note: note.trim() || null,
          unit_cost: kind === "purchase" ? Number(cost) : null,
        })),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const noteRequired = kind === "write_off" || kind === "count";

  return (
    <Modal title={p.name} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">{t("Hozirgi qoldiq: {a} {b}", { a: formatQty(p.current_qty), b: p.unit })}</p>
      <Tabs<MoveKind>
        value={kind}
        onChange={setKind}
        tabs={[
          { id: "purchase", label: t("Kirim") },
          { id: "usage", label: t("Ishlatildi") },
          { id: "write_off", label: t("Hisobdan chiqarish") },
          { id: "count", label: t("Sanoq") },
        ]}
      />
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{kind === "count" ? t("Sanalgan qoldiq ({a})", { a: p.unit }) : t("Miqdor ({a})", { a: p.unit })}
            <input className={inputClass} type="number" inputMode="decimal" required data-autofocus
              min={kind === "count" ? 0 : 0.001} step={0.001} value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          {kind === "purchase" && (
            <label className="block text-sm">{t("Bir birlik narxi")}
              <input className={inputClass} type="number" inputMode="numeric" required min={0} step={1} value={cost}
                onChange={(e) => setCost(e.target.value)} />
            </label>
          )}
        </div>
        <label className="block text-sm">{noteRequired ? t("Sabab") : t("Izoh (ixtiyoriy)")}
          <input className={inputClass} required={noteRequired} minLength={noteRequired ? 3 : undefined} maxLength={500}
            value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {save.error && <ErrorNote error={save.error} />}
        <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
      </form>
    </Modal>
  );
}
