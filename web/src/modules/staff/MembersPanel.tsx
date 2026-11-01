// Xodimlar ro'yxati va boshqaruvi. Direktor panelida ham, Super Admin oynasida ham shu komponent.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { Member, MemberPermission, MemberService, Service } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { formatMoney, normalizePhone, ROLE_LABELS } from "../../components/format";
import { Modal } from "../../components/Modal";
import { Badge, Button, Empty, ErrorNote, inputClass, Spinner, Tabs } from "../../components/ui";
import { ScheduleEditor } from "./ScheduleEditor";

const membersKey = (b: number) => ["members", b];

export function useMembers(businessId: number) {
  return useQuery({
    queryKey: membersKey(businessId),
    queryFn: () => api<Member[]>(`/businesses/${businessId}/members`),
  });
}

/** Menejerni faqat direktor va Super Admin qo'shadi (baza ham shuni tekshiradi) */
export function MembersPanel({ businessId, canManageManagers }: { businessId: number; canManageManagers: boolean }) {
  const members = useMembers(businessId);
  const [adding, setAdding] = useState(false);
  const [openedId, setOpenedId] = useState<number | null>(null);
  const opened = members.data?.find((m) => m.id === openedId);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button className="flex items-center gap-1" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden /> Xodim qo'shish
        </Button>
      </div>
      {members.isPending && <Spinner />}
      {members.error && <ErrorNote error={members.error} />}
      {members.data?.length === 0 && <Empty>Hali xodim yo'q</Empty>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {members.data?.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => setOpenedId(m.id)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-page"
            >
              <span className="min-w-40 flex-1">
                <span className="block font-medium">{m.full_name || m.phone}</span>
                <span className="block text-muted tabular-nums">{m.phone}{m.title ? ` · ${m.title}` : ""}</span>
              </span>
              <Badge tone={m.role === "owner" ? "green" : "gray"}>{ROLE_LABELS[m.role]}</Badge>
              {!m.is_active && <Badge tone="red">Faol emas</Badge>}
            </button>
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

const roleOptions = (managers: boolean) =>
  (managers ? ["staff", "receptionist", "manager"] : ["staff", "receptionist"]).map((r) => ({
    value: r,
    label: ROLE_LABELS[r],
  }));

function AddMember({ businessId, canManageManagers, onClose }: {
  businessId: number;
  canManageManagers: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("staff");
  const [title, setTitle] = useState("");

  const add = useMutation({
    mutationFn: () =>
      api<Member>(`/businesses/${businessId}/members`, json("POST", {
        phone: normalizePhone(phone),
        full_name: name.trim(),
        role,
        title: title.trim() || null,
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
    <Modal title="Yangi xodim" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Telefon
          <input className={inputClass} type="tel" required placeholder="90 123 45 67" value={phone}
            onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="block text-sm">Ism familiya
          <input className={inputClass} required minLength={2} maxLength={120} value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">Rol
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
            {roleOptions(canManageManagers).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">Lavozim
          <input className={inputClass} maxLength={80} placeholder="Barber, kosmetolog" value={title}
            onChange={(e) => setTitle(e.target.value)} />
        </label>
        {add.error && <ErrorNote error={add.error} />}
        <Button type="submit" disabled={add.isPending} className="w-full">Qo'shish</Button>
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
  const isSelf = me?.user.id === m.user_id;
  const isOwner = m.role === "owner";
  // Direktorni va o'zini tahrirlash taqiqlangan, menejerni faqat direktor boshqaradi: baza rad etadi, tugmani ham ko'rsatmaymiz
  const editable = !isSelf && !isOwner && (m.role !== "manager" || canManageManagers);
  const showPassword = m.password_block === null || m.password_block === "shared_account";
  const tabs: { id: Tab; label: string }[] = [
    { id: "main", label: "Asosiy" },
    ...(editable ? [{ id: "permissions" as const, label: "Huquqlar" }, { id: "services" as const, label: "Xizmatlar" }] : []),
    { id: "schedule", label: "Ish jadvali" },
    ...(showPassword ? [{ id: "password" as const, label: "Parol" }] : []),
  ];
  const [tab, setTab] = useState<Tab>("main");

  return (
    <Modal title={m.full_name || m.phone} onClose={onClose}>
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
        <dt className="text-muted">Telefon</dt><dd className="tabular-nums">{m.phone}</dd>
        <dt className="text-muted">Rol</dt><dd>{ROLE_LABELS[m.role]}</dd>
        {m.title && <><dt className="text-muted">Lavozim</dt><dd>{m.title}</dd></>}
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
      <label className="block text-sm">Rol
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
          {roleOptions(canManageManagers).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="block text-sm">Lavozim
        <input className={inputClass} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={m.is_bookable}
          onChange={(e) => update.mutate({ is_bookable: e.target.checked })} />
        Mijoz qabul qiladi (kalendarda ko'rinadi)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={m.is_active}
          onChange={(e) => update.mutate({ is_active: e.target.checked })} />
        Faol xodim (o'chirilsa, panelga kira olmaydi, ma'lumotlar saqlanadi)
      </label>
      {update.error && <ErrorNote error={update.error} />}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={update.isPending}>Saqlash</Button>
        {update.isSuccess && <span className="text-sm text-success">Saqlandi</span>}
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
        Rol standart huquqlarni beradi. Shu yerda alohida ruxsat berish yoki taqiqlash mumkin.
      </p>
      {set.error && <div className="mb-2"><ErrorNote error={set.error} /></div>}
      <ul className="divide-y divide-line">
        {query.data.map((p) => (
          <li key={p.code} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block">{p.description ?? p.code}</span>
              {!p.module_enabled && <span className="block text-xs text-warning">Modul o'chiq</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge tone={p.effective ? "green" : "gray"}>{p.effective ? "Bor" : "Yo'q"}</Badge>
              <select
                aria-label={p.description ?? p.code}
                disabled={set.isPending || !p.module_enabled}
                value={p.override === null ? "" : String(p.override)}
                onChange={(e) =>
                  set.mutate({ code: p.code, granted: e.target.value === "" ? null : e.target.value === "true" })
                }
                className="rounded-lg border border-line bg-white px-2 py-1 text-xs"
              >
                <option value="">Rol bo'yicha</option>
                <option value="true">Ruxsat</option>
                <option value="false">Taqiq</option>
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
  if (active.length === 0) return <Empty>Avval "Xizmatlar" bo'limida xizmat qo'shing</Empty>;

  const toggle = (id: number, on: boolean) =>
    save.mutate(on
      ? [...assigned.data, { service_id: id, custom_price: null, custom_duration: null }]
      : assigned.data.filter((a) => a.service_id !== id));

  return (
    <>
      <p className="mb-2 text-sm text-muted">Usta bajaradigan xizmatlar. Faqat shular uchun unga bron qilinadi.</p>
      {save.error && <div className="mb-2"><ErrorNote error={save.error} /></div>}
      <ul className="divide-y divide-line">
        {active.map((s) => (
          <li key={s.id} className="py-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-primary" disabled={save.isPending}
                checked={assigned.data.some((a) => a.service_id === s.id)}
                onChange={(e) => toggle(s.id, e.target.checked)} />
              <span className="flex-1">{s.name}</span>
              <span className="text-muted tabular-nums">{s.duration_min} daq · {formatMoney(s.price)}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}

// Tasodifiy vaqtinchalik parol: crypto, chalkashtiradigan belgilarsiz
function generatePassword() {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (chars: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => chars[x % chars.length]).join("");
  return pick(letters, 8) + pick(digits, 4);
}

function PasswordTab({ businessId, member: m }: { businessId: number; member: Member }) {
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/businesses/${businessId}/members/${m.id}/password`, json("POST", { new_password: password })),
  });

  if (m.password_block === "shared_account") {
    return (
      <p className="text-sm text-muted">
        Bu odam boshqa salon yoki mijoz hisobiga ham bog'langan. Xavfsizlik uchun parolni o'zi o'zgartiradi
        yoki Super Admin tiklaydi.
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
        Yangi parol o'rnatilgach, xodimning barcha qurilmalardagi kirishi yopiladi. Parolni xodimga shaxsan bering,
        kirgach o'zi almashtirsin.
      </p>
      <label className="block text-sm">Yangi parol
        <span className="mt-1 flex gap-2">
          <input className={`${inputClass} mt-0 font-mono`} required minLength={8} maxLength={128} autoComplete="off"
            value={password}
            onChange={(e) => { setPassword(e.target.value); save.reset(); }} />
          <Button type="button" variant="secondary" onClick={() => { setPassword(generatePassword()); save.reset(); }}>
            Yaratish
          </Button>
        </span>
      </label>
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>Parolni o'rnatish</Button>
        {save.isSuccess && <span className="text-sm text-success">O'rnatildi, xodim endi shu parol bilan kiradi</span>}
      </div>
    </form>
  );
}
