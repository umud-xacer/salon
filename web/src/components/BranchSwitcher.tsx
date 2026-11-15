import { useLocation, useNavigate } from "react-router-dom";

import type { Membership } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { t } from "../i18n";

/** Bitta tarmoq (asosiy kompaniya + filiallari) ichidagi a'zoliklar. Tarmoqqa kirmagan muassasalar qo'shilmaydi. */
export function chainMemberships(all: Membership[], current: Membership): Membership[] {
  const chain = current.chain_id ?? current.business_id;
  return all
    .filter((m) => (m.chain_id ?? m.business_id) === chain)
    .sort((a, b) => Number(!!a.parent_id) - Number(!!b.parent_id)
      || (a.branch_name ?? "").localeCompare(b.branch_name ?? "") || a.business_name.localeCompare(b.business_name));
}

export function branchLabel(m: Membership): string {
  if (m.branch_name) return `${m.business_name} · ${m.branch_name}`;
  return m.parent_id ? m.business_name : t("{a} (asosiy)", { a: m.business_name });
}

/**
 * Filial almashtirgich: shu tarmoqda 2 tadan ko'p a'zolik bo'lsagina chiqadi.
 * Tanlanganda o'sha bo'limda qoladi (/barber-lab/kassa -> /barber-lab-chilonzor/kassa); bo'lim u filialda
 * bo'lmasa, BusinessPanel o'zi bosh sahifaga o'tkazadi. Kassa, ombor, xodimlar — URL'dagi muassasa bo'yicha.
 */
export function BranchSwitcher({ current, dark = false }: { current: Membership; dark?: boolean }) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const options = chainMemberships(me?.memberships ?? [], current);
  if (options.length < 2) return null;

  const go = (slug: string) => {
    const rest = pathname.split("/").slice(2).join("/");
    navigate(`/${slug}/${rest}`);
  };
  return (
    <label className="block min-w-0">
      <span className="sr-only">{t("Filialni tanlash")}</span>
      <select
        value={current.business_slug}
        onChange={(e) => go(e.target.value)}
        title={t("Filialni tanlash")}
        className={`w-full min-w-0 truncate rounded-lg border px-2 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 ${
          dark
            ? "border-white/20 bg-white/10 text-white focus-visible:ring-white/40 [&>option]:text-navy"
            : "border-line bg-white text-navy focus-visible:ring-primary/40"}`}
      >
        {options.map((m) => <option key={m.business_id} value={m.business_slug}>{branchLabel(m)}</option>)}
      </select>
    </label>
  );
}
