// Xodimlar ro'yxati va boshqaruvi. Direktor panelida ham, Super Admin oynasida ham shu komponent.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { Member, MemberPermission, MemberService, Service } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { DURATION_CHOICES, formatDate, formatDuration, formatMoney, normalizePhone } from "../../components/format";
import { roleLabel, useVocab, type Vocab } from "../vocab";
import { Modal } from "../../components/Modal";
import { Badge, Button, Empty, ErrorNote, inputClass, PasswordBadge, Spinner, Tabs } from "../../components/ui";
import { generatePassword, PasswordInput, PasswordReveal } from "../../components/PasswordReveal";
import { CredentialsBox } from "../../components/CredentialsBox";
import { ScheduleEditor } from "./ScheduleEditor";

import { t } from "../../i18n";
const membersKey = (b: number) => ["members", b];

export function useMembers(businessId: number) {
  return useQuery({
    queryKey: membersKey(businessId),
    queryFn: () => api<Member[]>(`/businesses/${businessId}/members`),
  });
}

/** Menejerni faqat direktor va Super Admin qo'shadi (baza ham shuni tekshiradi) */
export function MembersPanel({ businessId, canManageManagers }: { businessId: number; canManageManagers: boolean }) {
  const v = useVocab();
  const members = useMembers(businessId);
  const { me } = useAuth();
  // Super Admin faqat direktor parolini ko'radi, xodimlarnikini direktor (server ham shunday tekshiradi)
  const canView = (m: Member) => m.password_block === null && (me?.workspace !== "superadmin" || m.role === "owner");
  const [adding, setAdding] = useState(false);
  const [openedId, setOpenedId] = useState<number | null>(null);
  const opened = members.data?.find((m) => m.id === openedId);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button className="flex items-center gap-1" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden />{" "}{t("Xodim qo'shish")}
        </Button>
      </div>
      {members.isPending && <Spinner />}
      {members.error && <ErrorNote error={members.error} />}
      {members.data?.length === 0 && <Empty>{t("Hali xodim yo'q")}</Empty>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {members.data?.map((m) => (
          <li key={m.id} className="flex items-center hover:bg-page">
            <button
              onClick={() => setOpenedId(m.id)}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-3 pl-4 text-left text-sm"
            >
              <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                <span className="block font-medium break-words">{m.full_name || m.phone}</span>
                <span className="block text-muted tabular-nums">{m.phone}{m.title ? ` · ${m.title}` : ""}</span>
              </span>
              <Badge tone={m.role === "owner" ? "green" : "gray"}>{roleLabel(m.role, v)}</Badge>
              <PasswordBadge status={m.password_status} />
              {!m.is_active && <Badge tone="red">{t("Faol emas")}</Badge>}
            </button>
            <span className="shrink-0 pr-3">
              {canView(m) && <PasswordReveal businessId={businessId} memberId={m.id} status={m.password_status} />}
            </span>
          </li>
        ))}
      </ul>
      {adding && (
        <AddMember businessId={businessId} canManageManagers={canManageManagers} onClose={() => setAdding(false)} />
      )}
      {opened && (
        <MemberDialog
          key={opened.id}
          businessId={businessId}
          member={opened}
          canManageManagers={canManageManagers}
          onClose={() => setOpenedId(null)}
        />
      )}
    </>
  );
}

// Lavozim maydoniga turga mos tavsiyalar (Stomatolog-terapevt, Ortodont...). Erkin yozish ham mumkin.
// Klinikada ilova shifokorlarni aynan shu lavozim (mutaxassislik) bo'yicha guruhlaydi.
function StaffTitles() {
  const v = useVocab();
  if (!v.titles?.length) return null;
  return (
    <datalist id="staff-titles">
      {v.titles.map((tx) => <option key={tx} value={tx} />)}
    </datalist>
  );
}

const roleOptions = (managers: boolean, v: Vocab) =>
  (managers ? ["staff", "receptionist", "manager"] : ["staff", "receptionist"]).map((r) => ({
    value: r,
    label: roleLabel(r, v),
  }));

function AddMember({ businessId, canManageManagers, onClose }: {
  businessId: number;
  canManageManagers: boolean;
  onClose: () => void;
}) {
  const v = useVocab();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("staff");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");

  const add = useMutation({
    mutationFn: () =>
      api<Member>(`/businesses/${businessId}/members`, json("POST", {
        phone: normalizePhone(phone),
        full_name: name.trim(),
        role,
        title: title.trim() || null,
        password: password.trim() || null,
      })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: membersKey(businessId) });
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <Modal title={t("Yangi xodim")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">{t("Telefon (login)")}
          <input className={inputClass} type="tel" required placeholder="90 123 45 67" value={phone}
            onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="block text-sm">{t("Ism familiya")}
          <input className={inputClass} required minLength={2} maxLength={120} value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">{t("Rol")}
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
            {roleOptions(canManageManagers, v).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">{t("Lavozim")}
          <input className={inputClass} maxLength={80} list="staff-titles" placeholder={v.titles?.slice(0, 2).join(", ") || t("Lavozim")} value={title}
            onChange={(e) => setTitle(e.target.value)} />
        </label>
        <PasswordInput label={t("Boshlang'ich parol")} value={password} onChange={setPassword} />
        <StaffTitles />
        {add.error && <ErrorNote error={add.error} />}
        <Button type="submit" disabled={add.isPending} className="w-full">{t("Qo'shish")}</Button>
      </form>
    </Modal>
  );
}

type Tab = "main" | "permissions" | "services" | "schedule" | "password";

function MemberDialog({ businessId, member: m, canManageManagers, onClose }: {
  businessId: number;
  member: Member;
  canManageManagers: boolean;
  onClose: () => void;
}) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const isSelf = me?.user.id === m.user_id;
  const isOwner = m.role === "owner";
  // Direktorni va o'zini tahrirlash taqiqlangan, menejerni faqat direktor boshqaradi: baza rad etadi, tugmani ham ko'rsatmaymiz
  const editable = !isSelf && !isOwner && (m.role !== "manager" || canManageManagers);
  const tabs: { id: Tab; label: string }[] = [
    { id: "main", label: t("Asosiy") },
    ...(editable ? [{ id: "permissions" as const, label: t("Huquqlar") }, { id: "services" as const, label: t("Xizmatlar") }] : []),
    { id: "schedule", label: t("Ish jadvali") },
    ...(m.password_block === "shared_account" ? [{ id: "password" as const, label: t("Parol") }] : []),
  ];
  const [tab, setTab] = useState<Tab>("main");

  const canViewPassword = me?.workspace !== "superadmin" || m.role === "owner";
  return (
    <Modal title={m.full_name || m.phone} onClose={onClose}>
      {m.password_block === null && (
        <CredentialsBox title={t("Kirish ma'lumotlari")} businessId={businessId} memberId={m.id} phone={m.phone}
          status={m.password_status} changedAt={m.password_changed_at} canView={canViewPassword}
          onChanged={() => queryClient.invalidateQueries({ queryKey: membersKey(businessId) })} />
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "main" && <MainTab businessId={businessId} member={m} editable={editable} canManageManagers={canManageManagers} />}
      {tab === "permissions" && <PermissionsTab businessId={businessId} memberId={m.id} />}
      {tab === "services" && <ServicesTab businessId={businessId} memberId={m.id} />}
      {tab === "schedule" && <ScheduleEditor businessId={businessId} memberId={m.id} />}
      {tab === "password" && <PasswordTab businessId={businessId} member={m} />}
    </Modal>
  );
}

function MainTab({ businessId, member: m, editable, canManageManagers }: {
  businessId: number;
  member: Member;
  editable: boolean;
  canManageManagers: boolean;
}) {
  const v = useVocab();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(m.title ?? "");
  const [role, setRole] = useState<string>(m.role);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Member>(`/businesses/${businessId}/members/${m.id}`, json("PATCH", body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membersKey(businessId) }),
  });

  if (!editable) {
    return (
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{t("Telefon")}</dt><dd className="tabular-nums">{m.phone}</dd>
        <dt className="text-muted">{t("Rol")}</dt><dd>{roleLabel(m.role, v)}</dd>
        {m.title && <><dt className="text-muted">{t("Lavozim")}</dt><dd>{m.title}</dd></>}
      </dl>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ title: title.trim() || null, role });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted tabular-nums">{m.phone}</p>
      <label className="block text-sm">{t("Rol")}
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
          {roleOptions(canManageManagers, v).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="block text-sm">{t("Lavozim")}
        <input className={inputClass} maxLength={80} list="staff-titles" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <StaffTitles />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={m.is_bookable}
          onChange={(e) => update.mutate({ is_bookable: e.target.checked })} />
        {v.clientOne}{" "}{t("qabul qiladi (kalendarda ko'rinadi)")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={m.is_active}
          onChange={(e) => update.mutate({ is_active: e.target.checked })} />
        {t("Faol xodim (o'chirilsa, panelga kira olmaydi, ma'lumotlar saqlanadi)")}
      </label>
      {update.error && <ErrorNote error={update.error} />}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={update.isPending}>{t("Saqlash")}</Button>
        {update.isSuccess && <span className="text-sm text-success">{t("Saqlandi")}</span>}
      </div>
    </form>
  );
}

function PermissionsTab({ businessId, memberId }: { businessId: number; memberId: number }) {
  const url = `/businesses/${businessId}/members/${memberId}/permissions`;
  const key = ["member-permissions", businessId, memberId];
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: () => api<MemberPermission[]>(url) });
  const set = useMutation({
    mutationFn: ({ code, granted }: { code: string; granted: boolean | null }) =>
      api(`${url}/${code}`, json("PUT", { granted })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (query.isPending) return <Spinner />;
  if (query.error) return <ErrorNote error={query.error} />;

  return (
    <>
      <p className="mb-2 text-sm text-muted">
        {t("Rol standart huquqlarni beradi. Shu yerda alohida ruxsat berish yoki taqiqlash mumkin.")}
      </p>
      {set.error && <div className="mb-2"><ErrorNote error={set.error} /></div>}
      <ul className="divide-y divide-line">
        {query.data.map((p) => (
          <li key={p.code} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-0 basis-full [overflow-wrap:anywhere] sm:basis-auto sm:flex-1">
              <span className="block">{p.description ?? p.code}</span>
              {!p.module_enabled && <span className="block text-xs text-warning">{t("Modul o'chiq")}</span>}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <Badge tone={p.effective ? "green" : "gray"}>{p.effective ? t("Bor") : t("Yo'q")}</Badge>
              <select
                aria-label={p.description ?? p.code}
                disabled={set.isPending || !p.module_enabled}
                value={p.override === null ? "" : String(p.override)}
                onChange={(e) =>
                  set.mutate({ code: p.code, granted: e.target.value === "" ? null : e.target.value === "true" })
                }
                className="rounded-lg border border-line bg-white px-2 py-1 text-xs"
              >
                <option value="">{t("Rol bo'yicha")}</option>
                <option value="true">{t("Ruxsat")}</option>
                <option value="false">{t("Taqiq")}</option>
              </select>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function ServicesTab({ businessId, memberId }: { businessId: number; memberId: number }) {
  const url = `/businesses/${businessId}/members/${memberId}/services`;
  const v = useVocab();
  const queryClient = useQueryClient();
  const services = useQuery({
    queryKey: ["services", businessId],
    queryFn: () => api<Service[]>(`/businesses/${businessId}/services`),
  });
  const assigned = useQuery({ queryKey: ["member-services", businessId, memberId], queryFn: () => api<MemberService[]>(url) });
  const save = useMutation({
    mutationFn: (list: MemberService[]) => api<MemberService[]>(url, json("PUT", { services: list })),
    onSuccess: (data) => {
      queryClient.setQueryData(["member-services", businessId, memberId], data);
      return queryClient.invalidateQueries({ queryKey: ["reception-options", businessId] });
    },
  });

  if (services.isPending || assigned.isPending) return <Spinner />;
  if (services.error || assigned.error) return <ErrorNote error={services.error ?? assigned.error} />;
  const active = services.data.filter((s) => s.is_active);
  if (active.length === 0) return <Empty>{t("Avval \"Xizmatlar\" bo'limida xizmat qo'shing")}</Empty>;

  const toggle = (id: number, on: boolean) =>
    save.mutate(on
      ? [...assigned.data, { service_id: id, custom_price: null, custom_duration: null }]
      : assigned.data.filter((a) => a.service_id !== id));
  const setDuration = (id: number, minutes: number | null) =>
    save.mutate(assigned.data.map((a) => (a.service_id === id ? { ...a, custom_duration: minutes } : a)));

  return (
    <>
      <p className="mb-2 text-sm text-muted">{v.staffOne}{" "}{t("bajaradigan xizmatlar. Faqat shular uchun unga bron qilinadi.")}</p>
      {save.error && <div className="mb-2"><ErrorNote error={save.error} /></div>}
      <ul className="divide-y divide-line">
        {active.map((s) => {
          const mine = assigned.data.find((a) => a.service_id === s.id);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input type="checkbox" className="size-4 accent-primary" disabled={save.isPending}
                  checked={!!mine} onChange={(e) => toggle(s.id, e.target.checked)} />
                <span className="min-w-0 flex-1 break-words">{s.name}</span>
              </label>
              {mine ? (
                <select aria-label={t("{a}: {b}ga xos davomiylik", { a: s.name, b: v.staffOne.toLowerCase() })} disabled={save.isPending}
                  className="rounded-lg border border-line bg-white px-2 py-1 text-xs"
                  value={mine.custom_duration ?? ""}
                  onChange={(e) => setDuration(s.id, e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{formatDuration(s.duration_min)}{" "}{t("(umumiy)")}</option>
                  {DURATION_CHOICES.filter((m) => m !== s.duration_min).map((m) => (
                    <option key={m} value={m}>{formatDuration(m)}</option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-muted tabular-nums">{formatDuration(s.duration_min)}</span>
              )}
              <span className="w-24 text-right text-xs text-muted tabular-nums">{formatMoney(mine?.custom_price ?? s.price)}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">
        {t("Vaqt shu")}{" "}{v.staffOne.toLowerCase()}{t("ga xos bo'lishi mumkin (masalan, tezroq ishlaydi). Bron vaqtlari shunga qarab hisoblanadi.")}
        {v.staffOne}{" "}{t("ham o'z panelidagi \"Xizmatlarim\" bo'limida o'zgartira oladi.")}
      </p>
    </>
  );
}

function PasswordTab({ businessId, member: m }: { businessId: number; member: Member }) {
  const v = useVocab();
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/businesses/${businessId}/members/${m.id}/password`, json("POST", { new_password: password })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membersKey(businessId) }),
  });

  if (m.password_block === "shared_account") {
    return (
      <p className="text-sm text-muted">
        {t("Bu odam boshqa muassasa yoki")}{" "}{v.clientOne.toLowerCase()}{" "}{t("hisobiga ham bog'langan. Xavfsizlik uchun parolni o'zi o'zgartiradi yoki Super Admin tiklaydi.")}
      </p>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted">
        {t("Xodim shu parol bilan kiradi. Uni faqat rahbar o'zgartiradi — xodimning o'zi almashtira olmaydi. Yangi parol berilganda xodimning barcha kirishlari yopiladi. Parol ko'z tugmasi bilan doim ko'rinadi.")}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {t("Hozirgi holat:")}{" "}<PasswordBadge status={m.password_status} />
        {m.password_changed_at && <span className="text-muted">{formatDate(m.password_changed_at)}</span>}
        {(me?.workspace !== "superadmin" || m.role === "owner") && (
          <PasswordReveal businessId={businessId} memberId={m.id} status={m.password_status} />
        )}
      </p>
      <label className="block text-sm">{t("Yangi parol")}
        <span className="mt-1 flex gap-2">
          <input className={`${inputClass} mt-0 min-w-0 font-mono`} required minLength={8} maxLength={128} autoComplete="off"
            value={password}
            onChange={(e) => { setPassword(e.target.value); save.reset(); }} />
          <Button type="button" variant="secondary" onClick={() => { setPassword(generatePassword()); save.reset(); }}>
            {t("Yaratish")}
          </Button>
        </span>
      </label>
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>{t("Parolni o'rnatish")}</Button>
        {save.isSuccess && <span className="text-sm text-success">{t("O'rnatildi")}</span>}
      </div>
    </form>
  );
}
