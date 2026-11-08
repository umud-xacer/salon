import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FolderPlus, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from "react";

import { api, json } from "../../api/client";
import type { Membership, Service, ServiceCategory, ServicePresets } from "../../api/types";
import { formatDuration, formatMoney } from "../../components/format";
import { Modal } from "../../components/Modal";
import { vocabFor } from "../vocab";
import { getLang, pick, t } from "../../i18n";
import { Badge, Button, Card, Empty, ErrorNote, inputClass, PageTitle, Spinner } from "../../components/ui";

export function ServicesPage({ membership }: { membership: Membership }) {
  const b = membership.business_id;
  const queryClient = useQueryClient();
  const services = useQuery({ queryKey: ["services", b], queryFn: () => api<Service[]>(`/businesses/${b}/services`) });
  const categories = useQuery({
    queryKey: ["service-categories", b],
    queryFn: () => api<ServiceCategory[]>(`/businesses/${b}/service-categories`),
  });
  const [editing, setEditing] = useState<{ service: Service | null; categoryId?: number | null } | null>(null);
  const [catDialog, setCatDialog] = useState<ServiceCategory | "new" | null>(null);
  const [deleting, setDeleting] = useState<ServiceCategory | null>(null);
  const cats = categories.data ?? [];
  const all = services.data ?? [];

  // Bo'sh bo'limlar ham ko'rinadi (tahrirlash/o'chirish uchun); "Boshqa" — faqat unda xizmat bo'lsa
  const groups = [
    ...cats.map((c) => ({ cat: c as ServiceCategory | null, items: all.filter((s) => s.category_id === c.id) })),
    { cat: null, items: all.filter((s) => s.category_id === null || !cats.some((c) => c.id === s.category_id)) },
  ].filter((g) => g.cat !== null || g.items.length > 0);

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api<ServiceCategory[]>(`/businesses/${b}/service-categories/order`, json("PUT", { ids })),
    onMutate: async (ids) => {
      // Darhol joyidan siljiydi, server javobini kutmaydi
      await queryClient.cancelQueries({ queryKey: ["service-categories", b] });
      const prev = queryClient.getQueryData<ServiceCategory[]>(["service-categories", b]);
      if (prev) queryClient.setQueryData(["service-categories", b], ids.map((id) => prev.find((c) => c.id === id)!));
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["service-categories", b], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["service-categories", b] }),
  });
  const move = (index: number, dir: -1 | 1) => {
    const ids = cats.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <>
      <PageTitle
        title={vocabFor(membership.business_kind).services}
        hint={t("Narx o'zgarsa, eski bronlar narxi saqlanib qoladi")}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="flex items-center gap-1" onClick={() => setCatDialog("new")}>
              <FolderPlus size={16} aria-hidden /> {t("Bo'lim qo'shish")}
            </Button>
            <Button className="flex items-center gap-1" onClick={() => setEditing({ service: null })}>
              <Plus size={16} aria-hidden /> {t("Xizmat qo'shish")}
            </Button>
          </div>
        }
      />
      {services.isPending && <Spinner />}
      {services.error && <ErrorNote error={services.error} />}
      {reorder.error && <div className="mb-3"><ErrorNote error={reorder.error} /></div>}
      {services.data?.length === 0 && cats.length === 0 && <Card><Empty>{t("Hali xizmat yo'q")}</Empty></Card>}
      {services.data && <PresetsCard businessId={b} />}
      <div className="space-y-5">
        {groups.map((g) => {
          const cat = g.cat;
          const index = cat ? cats.findIndex((c) => c.id === cat.id) : -1;
          return (
            <section key={cat?.id ?? "other"}>
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="min-w-0 flex-1 text-sm font-medium break-words">
                  {cat ? pick(cat.name, cat.name_ru) : t("Boshqa")} <span className="font-normal text-muted">· {g.items.length}</span>
                </h2>
                {cat && (
                  <div className="flex items-center gap-0.5" role="group" aria-label={t("{name} bo'limi", { name: cat.name })}>
                    <IconButton label={t("Yuqoriga")} disabled={index === 0 || reorder.isPending} onClick={() => move(index, -1)}>
                      <ArrowUp size={15} aria-hidden />
                    </IconButton>
                    <IconButton label={t("Pastga")} disabled={index === cats.length - 1 || reorder.isPending} onClick={() => move(index, 1)}>
                      <ArrowDown size={15} aria-hidden />
                    </IconButton>
                    <IconButton label={t("Shu bo'limga xizmat qo'shish")} onClick={() => setEditing({ service: null, categoryId: cat.id })}>
                      <Plus size={15} aria-hidden />
                    </IconButton>
                    <IconButton label={t("Bo'lim nomini tahrirlash")} onClick={() => setCatDialog(cat)}>
                      <Pencil size={15} aria-hidden />
                    </IconButton>
                    <IconButton label={t("Bo'limni o'chirish")} danger onClick={() => setDeleting(cat)}>
                      <Trash2 size={15} aria-hidden />
                    </IconButton>
                  </div>
                )}
              </div>
              {g.items.length === 0 && cat ? (
                <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">
                  {t("Bu bo'limda hali xizmat yo'q.")}{" "}
                  <button className="text-primary hover:underline" onClick={() => setEditing({ service: null, categoryId: cat.id })}>
                    {t("Xizmat qo'shish")}
                  </button>
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line bg-white">
                  {g.items.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => setEditing({ service: s })}
                        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page"
                      >
                        <span className="min-w-0 basis-full break-words sm:basis-auto sm:flex-1">
                          <span className="font-medium">{pick(s.name, s.name_ru)}</span>
                          {getLang() === "uz" && s.name_ru && <span className="block text-xs text-muted" lang="ru">{s.name_ru}</span>}
                        </span>
                        {!s.is_active && <Badge tone="gray">{t("Yashirilgan")}</Badge>}
                        <span className="text-muted tabular-nums">{formatDuration(s.duration_min)}</span>
                        <span className="tabular-nums sm:w-28 sm:text-right">{formatMoney(s.price)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {editing && (
        <ServiceDialog
          businessId={b}
          service={editing.service}
          defaultCategory={editing.categoryId ?? null}
          categories={cats}
          onClose={() => setEditing(null)}
        />
      )}
      {catDialog && (
        <CategoryDialog businessId={b} category={catDialog === "new" ? null : catDialog} onClose={() => setCatDialog(null)} />
      )}
      {deleting && (
        <DeleteCategoryDialog
          businessId={b}
          category={deleting}
          others={cats.filter((c) => c.id !== deleting.id)}
          count={all.filter((s) => s.category_id === deleting.id).length}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function IconButton({ label, danger, children, ...props }:
  { label: string; danger?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid size-8 place-items-center rounded-lg text-muted transition hover:bg-page disabled:opacity-30 disabled:hover:bg-transparent ${danger ? "hover:text-danger" : "hover:text-ink"}`}
      {...props}
    >
      {children}
    </button>
  );
}

function useRefreshCategories(businessId: number) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ["service-categories", businessId] });
    await queryClient.invalidateQueries({ queryKey: ["services", businessId] });
    await queryClient.invalidateQueries({ queryKey: ["reception-options", businessId] });
  };
}

function CategoryDialog({ businessId, category, onClose }: {
  businessId: number;
  category: ServiceCategory | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [nameRu, setNameRu] = useState(category?.name_ru ?? "");
  const refresh = useRefreshCategories(businessId);
  const url = `/businesses/${businessId}/service-categories`;
  const save = useMutation({
    mutationFn: () => (category
      ? api(`${url}/${category.id}`, json("PATCH", { name: name.trim(), name_ru: nameRu.trim() }))
      : api(url, json("POST", { name: name.trim(), name_ru: nameRu.trim() || null }))),
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
    <Modal title={category ? t("Bo'limni tahrirlash") : t("Yangi bo'lim")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">{t("Bo'lim nomi")}
          <input data-autofocus className={inputClass} required maxLength={80} value={name}
            placeholder={t("Masalan: Quloq muolajalari")} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">{t("Ruscha nomi (ixtiyoriy)")}
          <input className={inputClass} maxLength={80} value={nameRu} lang="ru" placeholder="Процедуры для уха"
            onChange={(e) => setNameRu(e.target.value)} />
        </label>
        <p className="text-xs text-muted">{t("Mijozlar ilovada xizmatlarni shu bo'limlar bo'yicha, shu tartibda ko'radi.")}</p>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending || !name.trim()}>{t("Saqlash")}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteCategoryDialog({ businessId, category, others, count, onClose }: {
  businessId: number;
  category: ServiceCategory;
  others: ServiceCategory[];
  count: number;
  onClose: () => void;
}) {
  const [target, setTarget] = useState("");
  const refresh = useRefreshCategories(businessId);
  const remove = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/service-categories/${category.id}${target ? `?move_to=${target}` : ""}`,
      { method: "DELETE" }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  return (
    <Modal title={t("Bo'limni o'chirish")} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>{t("{name} bo'limi o'chiriladi.", { name: pick(category.name, category.name_ru) })}</p>
        {count > 0 ? (
          <>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              {t("Bu bo'limda {n} ta xizmat bor. Xizmatlar o'chmaydi — ular qayerga o'tsin?", { n: count })}
            </p>
            <label className="block">{t("Xizmatlarni ko'chirish")}
              <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{t('"Boshqa" guruhiga')}</option>
                {others.map((c) => <option key={c.id} value={c.id}>{pick(c.name, c.name_ru)}</option>)}
              </select>
            </label>
          </>
        ) : (
          <p className="text-muted">{t("Bo'lim bo'sh — hech qanday xizmatga ta'sir qilmaydi.")}</p>
        )}
        {remove.error && <ErrorNote error={remove.error} />}
        <div className="flex gap-2">
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("O'chirish")}</Button>
          <Button variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ServiceDialog({ businessId, service, defaultCategory = null, categories, onClose }: {
  businessId: number;
  service: Service | null;
  defaultCategory?: number | null;
  categories: ServiceCategory[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(service?.name ?? "");
  const [nameRu, setNameRu] = useState(service?.name_ru ?? "");
  const [duration, setDuration] = useState(String(service?.duration_min ?? 60));   // yangi xizmat — 1 soat
  const [price, setPrice] = useState(String(service?.price ?? ""));
  const [category, setCategory] = useState(
    service?.category_id ? String(service.category_id) : defaultCategory ? String(defaultCategory) : "",
  );
  const [description, setDescription] = useState(service?.description ?? "");
  const url = `/businesses/${businessId}/services`;

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["services", businessId] });
    await queryClient.invalidateQueries({ queryKey: ["reception-options", businessId] });
    await queryClient.invalidateQueries({ queryKey: ["service-categories", businessId] });
    onClose();
  };
  const save = useMutation({
    mutationFn: (extra: Record<string, unknown> = {}) => {
      const body = {
        name: name.trim(),
        name_ru: nameRu.trim() || (service ? "" : null),
        duration_min: Number(duration),
        price: Number(price),
        category_id: category ? Number(category) : null,
        description: description.trim() || null,
        ...extra,
      };
      return service ? api(`${url}/${service.id}`, json("PATCH", body)) : api(url, json("POST", body));
    },
    onSuccess: done,
  });
  const hide = useMutation({
    mutationFn: () => api(`${url}/${service!.id}`, { method: "DELETE" }),
    onSuccess: done,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({});
  };

  return (
    <Modal title={service ? t("Xizmatni tahrirlash") : t("Yangi xizmat")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">{t("Nomi")}
          <input className={inputClass} required minLength={2} maxLength={120} value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">{t("Ruscha nomi (ixtiyoriy)")}
          <input className={inputClass} maxLength={120} value={nameRu} lang="ru" placeholder="Стрижка"
            onChange={(e) => setNameRu(e.target.value)} />
          <span className="mt-0.5 block text-xs text-muted">{t("Ilova va panel rus tilida bo'lsa, shu nom ko'rinadi")}</span>
        </label>
        <fieldset>
          <legend className="text-sm">{t("Davomiyligi")}: <b>{Number(duration) >= 5 ? formatDuration(Number(duration)) : "—"}</b></legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[30, 45, 60, 90, 120].map((m) => (
              <button key={m} type="button" onClick={() => setDuration(String(m))}
                className={`rounded-full border px-3 py-1 text-xs ${Number(duration) === m ? "border-primary bg-primary text-white" : "border-line hover:bg-page"}`}>
                {formatDuration(m)}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">{t("Boshqa vaqt (daqiqa)")}
            <input className={inputClass} type="number" required min={5} max={720} step={5} value={duration}
              onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="block text-sm">{t("Narxi (so'm)")}
            <input className={inputClass} type="number" required min={0} step={1000} value={price}
              onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">{t("Bo'lim")}
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t("Boshqa")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{pick(c.name, c.name_ru)}</option>)}
          </select>
        </label>
        <label className="block text-sm">{t("Tavsif")}
          <textarea className={inputClass} rows={2} maxLength={2000} value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </label>
        {(save.error || hide.error) && <ErrorNote error={save.error ?? hide.error} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>{t("Saqlash")}</Button>
          {service?.is_active && (
            <Button type="button" variant="danger" disabled={hide.isPending} onClick={() => hide.mutate()}>
              {t("Yashirish")}
            </Button>
          )}
          {service && !service.is_active && (
            <Button type="button" variant="secondary" onClick={() => save.mutate({ is_active: true })}>
              {t("Qayta yoqish")}
            </Button>
          )}
        </div>
        {service && <p className="text-xs text-muted">{t("Xizmat o'chirilmaydi, yashiriladi: eski bronlar va hisobotlar buzilmaydi.")}</p>}
      </form>
    </Modal>
  );
}

// Muassasa turiga mos tayyor xizmatlar (Super Admin belgilaydi): bir bosishda qo'shiladi
function PresetsCard({ businessId }: { businessId: number }) {
  const queryClient = useQueryClient();
  const presets = useQuery({
    queryKey: ["service-presets", businessId],
    queryFn: () => api<ServicePresets>(`/businesses/${businessId}/service-presets`),
  });
  const [picked, setPicked] = useState<string[]>([]);
  const apply = useMutation({
    mutationFn: () => api(`/businesses/${businessId}/service-presets`, json("POST", { names: picked })),
    onSuccess: async () => {
      setPicked([]);
      await queryClient.invalidateQueries({ queryKey: ["services", businessId] });
      await queryClient.invalidateQueries({ queryKey: ["service-presets", businessId] });
      await queryClient.invalidateQueries({ queryKey: ["service-categories", businessId] });
    },
  });

  const available = presets.data?.presets.filter((p) => !p.exists) ?? [];
  if (!presets.data || available.length === 0) return null;
  const toggle = (name: string, on: boolean) => setPicked(on ? [...picked, name] : picked.filter((x) => x !== name));
  // Bo'limlar tavsiyadagi tartibda (stomatologiya: terapiya, gigiyena, ortodontiya...)
  const groups = [...available.reduce((m, p) => {
    const key = p.category ?? "";
    m.set(key, [...(m.get(key) ?? []), p]);
    return m;
  }, new Map<string, typeof available>())];

  return (
    <Card className="mb-4">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Sparkles size={16} className="text-primary" aria-hidden />
        {t("{name} uchun tavsiya xizmatlar", { name: pick(presets.data.category_name, presets.data.category_name_ru) })}
      </h2>
      <p className="mb-3 text-xs text-muted">
        {t("Belgilab qo'shing. {a} Narx va vaqtni keyin xizmatni bosib o'zgartirasiz.", { a: groups.length > 1 && `${t("Xizmat o'z bo'limiga tushadi (bo'lim bo'lmasa, yaratiladi).")} ` })}
      </p>
      <div className="space-y-3">
        {groups.map(([section, items]) => {
          const names = items.map((p) => p.name);
          const all = names.every((n) => picked.includes(n));
          return (
            <section key={section || "-"}>
              {groups.length > 1 && (
                <div className="mb-1 flex items-center justify-between gap-2 px-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{section ? pick(section, items[0]?.category_ru) : t("Boshqa")}</h3>
                  <button type="button" className="text-xs text-primary hover:underline"
                    onClick={() => setPicked(all ? picked.filter((n) => !names.includes(n)) : [...new Set([...picked, ...names])])}>
                    {all ? t("Belgini olish") : t("Bo'limni belgilash")}
                  </button>
                </div>
              )}
              <ul className="grid gap-1 sm:grid-cols-2">
                {items.map((p) => (
                  <li key={p.name}>
                    <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-page">
                      <input type="checkbox" className="size-4 accent-primary" checked={picked.includes(p.name)}
                        onChange={(e) => toggle(p.name, e.target.checked)} />
                      <span className="min-w-0 flex-1 break-words">{pick(p.name, p.name_ru)}</span>
                      <span className="text-xs text-muted tabular-nums">{formatDuration(p.duration_min)} · {formatMoney(p.price)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {apply.error && <div className="mt-2"><ErrorNote error={apply.error} /></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={picked.length === 0 || apply.isPending} onClick={() => apply.mutate()}>
          {picked.length ? t("{n} ta xizmatni qo'shish", { n: picked.length }) : t("Xizmatlarni belgilang")}
        </Button>
        <Button variant="secondary" disabled={apply.isPending}
          onClick={() => setPicked(picked.length === available.length ? [] : available.map((p) => p.name))}>
          {picked.length === available.length ? t("Belgini olib tashlash") : t("Hammasini belgilash")}
        </Button>
      </div>
    </Card>
  );
}
