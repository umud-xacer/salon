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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!sameOwner && b.owner_phone && !confirming) {
      setConfirming(true);
      return;
    }
    save.mutate();
  };

  if (!open) {
    return (
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="secondary" className="flex items-center gap-1" onClick={() => start("replace")}>
          <UserCog size={15} aria-hidden /> Direktorni almashtirish
        </Button>
        {b.owner_phone && (
          <Button variant="secondary" onClick={() => start("rename")}>Direktor ismini tuzatish</Button>
        )}
        {save.isSuccess && <span className="self-center text-sm text-success">Saqlandi</span>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-xl border border-line p-4 text-sm">
      <p className="font-medium">{sameOwner ? "Direktor ma'lumotini tuzatish" : "Yangi direktor"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">Telefon (login)
          <input className={inputClass} type="tel" required placeholder="90 123 45 67" value={phone}
            onChange={(e) => { setPhone(e.target.value); setConfirming(false); }} />
        </label>
        <label className="block">Ism familiya
          <input className={inputClass} required minLength={2} maxLength={120} value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <PasswordInput label={sameOwner ? "Yangi parol (ixtiyoriy)" : "Boshlang'ich parol (ixtiyoriy)"}
        value={password} onChange={setPassword} />
      {!sameOwner && b.owner_phone && (
        <fieldset className="space-y-1">
          <legend className="mb-1">Hozirgi direktor ({b.owner_name ?? b.owner_phone}):</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="previous" className="accent-primary" checked={previous === "manager"}
              onChange={() => setPrevious("manager")} />
            Menejer bo'lib qolsin
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="previous" className="accent-primary" checked={previous === "remove"}
              onChange={() => setPrevious("remove")} />
            Muassasadan chiqarilsin (hisobi o'chmaydi, bu muassasaga kira olmaydi)
          </label>
        </fieldset>
      )}
      {!sameOwner && (
        <p className="text-xs text-muted">
          Bu odam muassasada xodim bo'lsa, o'sha a'zolik direktorga ko'tariladi. Yangi direktor www.ariqalqon.uz dan
          shu telefon va parol bilan kiradi.
        </p>
      )}
      {confirming && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
          {b.owner_name ?? b.owner_phone} o'rniga {name.trim() || normalized} direktor bo'ladi
          ({previous === "manager" ? "eski direktor menejer bo'lib qoladi" : "eski direktor chiqariladi"}).
          Tasdiqlash uchun yana bir marta bosing.
        </p>
      )}
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={confirming ? "danger" : "primary"} disabled={save.isPending}>
          {sameOwner ? "Saqlash" : confirming ? "Ha, almashtirish" : "Direktorni almashtirish"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Bekor</Button>
      </div>
    </form>
  );
}
