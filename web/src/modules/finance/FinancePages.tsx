import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { CashDay, Expense, ExpenseCategory, ExpenseList, Membership, UnpaidAppointment } from "../../api/types";
import { addDays, formatDate, formatMoney, formatTime, METHOD_LABELS, STATUS_LABELS, todayIso } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";
import { PaymentPanel, PaymentRow } from "./PaymentPanel";
import { useVocab } from "../vocab";

import { dyn, expenseNote, pickList, t } from "../../i18n";
function Tile({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <Card>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 tabular-nums break-words ${strong ? "text-lg font-semibold text-navy" : "text-lg"}`}>
        {formatMoney(value)}
      </p>
    </Card>
  );
}

export function CashPage({ membership }: { membership: Membership }) {
  const v = useVocab();
  const b = membership.business_id;
  const queryClient = useQueryClient();
  const [day, setDay] = useState(todayIso);
  const [paying, setPaying] = useState<UnpaidAppointment | null>(null);
  const query = useQuery({
    queryKey: ["cash-day", b, day],
    placeholderData: keepPreviousData,
    queryFn: () => api<CashDay>(`/businesses/${b}/cash/day?date=${day}`),
  });
  const data = query.data;
  const canRefund = membership.permissions.includes("payments.refund");

  return (
    <>
      <PageTitle
        title={t("Kassa")}
        hint={t("Qaytarish qaytarilgan kunga yoziladi")}
        action={
          <div className="flex items-center gap-1">
            <Button variant="secondary" aria-label={t("Oldingi kun")} onClick={() => setDay(addDays(day, -1))}>
              <ChevronLeft size={16} aria-hidden />
            </Button>
            <input type="date" aria-label={t("Kun")} className="rounded-lg border border-line bg-white px-2 py-2 text-sm"
              value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            <Button variant="secondary" aria-label={t("Keyingi kun")} onClick={() => setDay(addDays(day, 1))}>
              <ChevronRight size={16} aria-hidden />
            </Button>
          </div>
        }
      />
      {query.isPending && <Spinner />}
      {query.error && <ErrorNote error={query.error} />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
            <Tile label={t("Kirim")} value={data.income} />
            <Tile label={t("Qaytarilgan")} value={data.refunds} />
            {data.expenses !== null && <Tile label={t("Xarajat")} value={data.expenses} />}
            {data.net !== null && <Tile label={t("Sof tushum")} value={data.net} strong />}
          </div>

          {data.methods.length > 0 && (
            <Card>
              <h2 className="mb-2 text-sm font-medium">{t("To'lov usullari")}</h2>
              <ul className="divide-y divide-line text-sm">
                {data.methods.map((m) => (
                  <li key={m.method} className="flex justify-between gap-3 py-1.5">
                    <span>{METHOD_LABELS[m.method] ?? m.method}</span>
                    <span className="tabular-nums">{formatMoney(m.income - m.refunds)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <h2 className="mb-1 text-sm font-medium">{t("To'lanmagan bronlar")}</h2>
            {data.unpaid.length === 0 ? <Empty>{t("Qarz yo'q")}</Empty> : (
              <ul className="divide-y divide-line text-sm">
                {data.unpaid.map((u) => (
                  <li key={u.id}>
                    <button onClick={() => setPaying(u)}
                      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left hover:bg-page">
                      <span className="text-muted tabular-nums">{formatTime(u.starts_at)}</span>
                      <span className="min-w-0 flex-1 basis-40">
                        <span className="block font-medium break-words">{u.client_name}</span>
                        <span className="block text-xs text-muted break-words">
                          {pickList(u.services, u.services_ru).join(", ")} · {u.member_name} · {STATUS_LABELS[u.status] ?? u.status}
                        </span>
                      </span>
                      <span className="tabular-nums">{formatMoney(u.due)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-1 text-sm font-medium">{t("Kun to'lovlari")}</h2>
            {data.payments.length === 0 ? <Empty>{t("To'lov yo'q")}</Empty> : (
              <ul className="divide-y divide-line text-sm">
                {data.payments.map((p) => (
                  <PaymentRow key={p.id} businessId={b} payment={p} canRefund={canRefund} showClient
                    onRefunded={() => queryClient.invalidateQueries({ queryKey: ["cash-day", b] })} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {paying && (
        <Modal title={paying.client_name ?? v.clientOne} onClose={() => setPaying(null)}>
          <p className="text-sm text-muted">{pickList(paying.services, paying.services_ru).join(", ")}</p>
          <PaymentPanel membership={membership} appointmentId={paying.id} onPaid={() => setPaying(null)} />
        </Modal>
      )}
    </>
  );
}

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};

export function ExpensesPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [managing, setManaging] = useState(false);
  const { from, to } = monthRange(month);

  const query = useQuery({
    queryKey: ["expenses", b, month],
    placeholderData: keepPreviousData,
    queryFn: () => api<ExpenseList>(`/businesses/${b}/expenses?date_from=${from}&date_to=${to}`),
  });
  const categories = useQuery({
    queryKey: ["expense-categories", b],
    queryFn: () => api<ExpenseCategory[]>(`/businesses/${b}/expense-categories`),
  });

  return (
    <>
      <PageTitle
        title={t("Xarajatlar")}
        hint={query.data ? t("Jami: {a}", { a: formatMoney(query.data.total) }) : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <input type="month" aria-label={t("Oy")} className="rounded-lg border border-line bg-white px-2 py-2 text-sm"
              value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <Button variant="secondary" onClick={() => setManaging(true)}>{t("Toifalar")}</Button>
            <Button className="flex items-center gap-1" onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden />{" "}{t("Xarajat")}
            </Button>
          </div>
        }
      />
      {query.isPending && <Spinner />}
      {query.error && <ErrorNote error={query.error} />}
      {query.data?.items.length === 0 && <Card><Empty>{t("Bu oyda xarajat yo'q")}</Empty></Card>}
      {query.data && query.data.items.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {query.data.items.map((e) => (
            <li key={e.id}>
              <button onClick={() => setEditing(e)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page">
                <span className="text-muted tabular-nums">{formatDate(`${e.spent_at}T12:00:00Z`)}</span>
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block font-medium break-words">{e.category_name ? dyn(e.category_name) : t("Toifasiz")}</span>
                  {e.note && <span className="block text-xs text-muted break-words">{expenseNote(e.note)}</span>}
                </span>
                <span className="tabular-nums">{formatMoney(e.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ExpenseDialog businessId={b} expense={editing === "new" ? null : editing}
          categories={categories.data ?? []} onClose={() => setEditing(null)} />
      )}
      {managing && (
        <CategoriesDialog businessId={b} categories={categories.data ?? []} onClose={() => setManaging(false)} />
      )}
    </>
  );
}

function ExpenseDialog({ businessId, expense, categories, onClose }: {
  businessId: number;
  expense: Expense | null;
  categories: ExpenseCategory[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const url = `/businesses/${businessId}/expenses`;
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [day, setDay] = useState(expense?.spent_at ?? todayIso());
  const [category, setCategory] = useState(expense?.category_id ? String(expense.category_id) : "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["expenses", businessId] });
    await queryClient.invalidateQueries({ queryKey: ["cash-day", businessId] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { amount: Number(amount), spent_at: day, category_id: category ? Number(category) : null,
                     note: note.trim() || null };
      return expense ? api(`${url}/${expense.id}`, json("PUT", body)) : api(url, json("POST", body));
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api(`${url}/${expense!.id}`, { method: "DELETE" }), onSuccess: done });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal title={expense ? t("Xarajatni tahrirlash") : t("Yangi xarajat")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t("Summa")}
            <input className={inputClass} type="number" inputMode="numeric" required min={1} step={1} data-autofocus
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Sana")}
            <input className={inputClass} type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">{t("Toifa")}
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t("Toifasiz")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{dyn(c.name)}</option>)}
          </select>
        </label>
        <label className="block text-sm">{t("Izoh")}
          <textarea className={inputClass} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {(save.error || remove.error) && <ErrorNote error={save.error ?? remove.error} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
          {expense && (confirmDelete ? (
            <Button type="button" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("Ha, o'chirish")}</Button>
          ) : (
            <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>{t("O'chirish")}</Button>
          ))}
        </div>
      </form>
    </Modal>
  );
}

function CategoriesDialog({ businessId, categories, onClose }: {
  businessId: number;
  categories: ExpenseCategory[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const url = `/businesses/${businessId}/expense-categories`;
  const [name, setName] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["expense-categories", businessId] });

  const add = useMutation({
    mutationFn: () => api(url, json("POST", { name: name.trim() })),
    onSuccess: async () => {
      setName("");
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`${url}/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["expenses", businessId] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <Modal title={t("Xarajat toifalari")} onClose={onClose}>
      <form onSubmit={submit} className="flex items-end gap-2">
        <label className="block min-w-0 flex-1 text-sm">{t("Yangi toifa")}
          <input className={inputClass} required data-autofocus minLength={2} maxLength={80} placeholder={t("Ijara, kommunal")}
            value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <Button type="submit" disabled={add.isPending}>{t("Qo'shish")}</Button>
      </form>
      {(add.error || remove.error) && <div className="mt-3"><ErrorNote error={add.error ?? remove.error} /></div>}
      {categories.length === 0 ? <Empty>{t("Toifa yo'q")}</Empty> : (
        <ul className="mt-3 divide-y divide-line text-sm">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 break-words">{c.name}</span>
              <button aria-label={t("{a} toifasini o'chirish", { a: c.name })} className="text-muted hover:text-danger"
                disabled={remove.isPending} onClick={() => remove.mutate(c.id)}>
                <Trash2 size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">{t("Toifa o'chirilsa, xarajatlar saqlanadi va toifasiz bo'lib qoladi.")}</p>
    </Modal>
  );
}
