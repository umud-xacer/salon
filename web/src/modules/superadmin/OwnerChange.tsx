// Super Admin: muassasa direktorini almashtirish yoki ismini tuzatish.
// Telefon o'sha odamniki bo'lsa — faqat ism (va parol) yangilanadi. Eski direktor menejer bo'lib qoladi yoki chiqariladi.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, json } from "../../api/client";
import type { BusinessAdmin } from "../../api/types";
import { normalizePhone } from "../../components/format";
import { PasswordInput } from "../../components/PasswordReveal";
import { Button, ErrorNote, inputClass } from "../../components/ui";
import { PhoneOwnerHint, usePhoneLookup } from "./PhoneOwnerHint";

import { t } from "../../i18n";
export function OwnerChange({ business: b }: { business: BusinessAdmin }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [previous, setPrevious] = useState<"manager" | "remove">("manager");
  const [confirming, setConfirming] = useState(false);

  const normalized = phone.trim() ? normalizePhone(phone) : "";
  const sameOwner = !!b.owner_phone && normalized === b.owner_phone;
  const lookup = usePhoneLookup(open ? phone : "");

  const save = useMutation({
    mutationFn: () => api<BusinessAdmin>(`/superadmin/businesses/${b.id}/owner`, json("PUT", {
      phone: normalized, full_name: name.trim(), password: password.trim() || null, previous,
    })),
    onSuccess: async () => {
      setOpen(false);
      setConfirming(false);
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["superadmin"] });
      await queryClient.invalidateQueries({ queryKey: ["members", b.id] });
    },
  });

  const start = (mode: "rename" | "replace") => {
    setOpen(true);
    setConfirming(false);
    save.reset();
    if (mode === "rename") {
      setPhone(b.owner_phone ?? "");
      setName(b.owner_name ?? "");
    } else {
      setPhone("");
      setName("");
    }
  };

  // Shu odam boshqa muassasalarda ham bor: ism hammasida o'zgaradi — tasdiqlatamiz
  const shared = (lookup.data?.memberships ?? []).filter((m) => m.business_id !== b.id).length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (((!sameOwner && b.owner_phone) || (sameOwner && shared)) && !confirming) {
      setConfirming(true);
      return;
    }
    save.mutate();
  };

  if (!open) {
    return (
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="secondary" className="flex items-center gap-1" onClick={() => start("replace")}>
          <UserCog size={15} aria-hidden />{" "}{t("Direktorni almashtirish")}
        </Button>
        {b.owner_phone && (
          <Button variant="secondary" onClick={() => start("rename")}>{t("Direktor ismini tuzatish")}</Button>
        )}
        {save.isSuccess && <span className="self-center text-sm text-success">{t("Saqlandi")}</span>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-xl border border-line p-4 text-sm">
      <p className="font-medium">{sameOwner ? t("Direktor ma'lumotini tuzatish") : t("Yangi direktor")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">{t("Telefon (login)")}
          <input className={inputClass} type="tel" required placeholder="90 123 45 67" value={phone}
            onChange={(e) => { setPhone(e.target.value); setConfirming(false); }} />
        </label>
        <label className="block">{t("Ism familiya")}
          <input className={inputClass} required minLength={2} maxLength={120} value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <PhoneOwnerHint lookup={lookup.data} businessId={b.id} mode={sameOwner ? "rename" : "assign"} />
      <PasswordInput label={sameOwner ? t("Yangi parol (ixtiyoriy)") : t("Boshlang'ich parol (ixtiyoriy)")}
        value={password} onChange={setPassword} />
      {!sameOwner && b.owner_phone && (
        <fieldset className="space-y-1">
          <legend className="mb-1">{t("Hozirgi direktor ({a}):", { a: b.owner_name ?? b.owner_phone })}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="previous" className="accent-primary" checked={previous === "manager"}
              onChange={() => setPrevious("manager")} />
            {t("Menejer bo'lib qolsin")}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="previous" className="accent-primary" checked={previous === "remove"}
              onChange={() => setPrevious("remove")} />
            {t("Muassasadan chiqarilsin (hisobi o'chmaydi, bu muassasaga kira olmaydi)")}
          </label>
        </fieldset>
      )}
      {!sameOwner && (
        <p className="text-xs text-muted">
          {t("Bu odam muassasada xodim bo'lsa, o'sha a'zolik direktorga ko'tariladi. Yangi direktor www.ariqalqon.uz dan shu telefon va parol bilan kiradi.")}
        </p>
      )}
      {confirming && sameOwner && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
          {t("Ism shu telefon egasining hamma muassasalarida \"{a}\" bo'ladi. Rozimisiz? Yana bir marta bosing.", { a: name.trim() })}
        </p>
      )}
      {confirming && !sameOwner && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
          {t("{a} o'rniga {b} direktor bo'ladi ({c}). Tasdiqlash uchun yana bir marta bosing.", { a: b.owner_name ?? b.owner_phone, b: name.trim() || normalized, c: previous === "manager" ? t("eski direktor menejer bo'lib qoladi") : t("eski direktor chiqariladi") })}
        </p>
      )}
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={confirming ? "danger" : "primary"} disabled={save.isPending}>
          {sameOwner ? (confirming ? t("Ha, hammasida o'zgartirish") : t("Saqlash")) : confirming ? t("Ha, almashtirish") : t("Direktorni almashtirish")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("Bekor")}</Button>
      </div>
    </form>
  );
}
