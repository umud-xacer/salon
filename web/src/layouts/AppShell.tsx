import { KeyRound, LogOut, Menu, Pencil, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { ChangePasswordDialog } from "../components/ChangePasswordDialog";
import { ProfileNameDialog } from "../components/ProfileNameDialog";
import { Logo } from "../components/ui";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;                 // faqat aynan shu manzilda faol
  sub?: boolean;                 // ichki band (masalan, "Salonlar" ostidagi turlar)
  badge?: number;                // yonidagi son
}

const footerButton = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10";

export function AppShell({ nav, title, header, children }: {
  nav: NavItem[];
  title: string;
  header?: ReactNode;
  children: ReactNode;
}) {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-dvh md:flex">
      {/* Telefon va kichik planshetda menyu ustma-ust ochiladi, kontentni surmaydi */}
      {open && <button aria-label="Menyuni yopish" className="fixed inset-0 z-30 bg-navy/60 md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-64 max-w-[85vw] flex-col bg-navy text-white transition-transform md:sticky md:top-0 md:w-60 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 p-4">
          <Logo />
          <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
          <button className="md:hidden" onClick={() => setOpen(false)} aria-label="Menyuni yopish">
            <X size={22} />
          </button>
        </div>
        {header && <div className="px-3 pb-2">{header}</div>}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {nav.map(({ to, label, icon: Icon, end, sub, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg py-2.5 text-sm md:py-2 ${sub ? "ml-4 border-l border-white/15 pl-3" : "px-3"} ${
                  isActive ? "bg-primary" : "text-white/80 hover:bg-white/10"}`
              }
            >
              <Icon size={sub ? 16 : 18} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {badge !== undefined && <span className="mr-2 text-xs tabular-nums text-white/60">{badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <button onClick={() => { setOpen(false); setEditingName(true); }} title="Ismni tahrirlash"
            className="flex w-full items-center gap-2 truncate rounded-lg px-3 pb-2 pt-1 text-left text-sm text-white/70 hover:bg-white/10">
            <span className="min-w-0 flex-1 truncate">{me?.user.full_name || me?.user.phone}</span>
            <Pencil size={14} aria-hidden className="shrink-0" />
            <span className="sr-only">Ismni tahrirlash</span>
          </button>
          {me?.workspace === "superadmin" && (
            <button onClick={() => { setOpen(false); setChangingPassword(true); }} className={footerButton}>
              <KeyRound size={18} aria-hidden />
              Parolni o'zgartirish
            </button>
          )}
          <button onClick={() => void signOut()} className={footerButton}>
            <LogOut size={18} aria-hidden />
            Chiqish
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Menyu" aria-expanded={open}>
            <Menu size={24} />
          </button>
          <Logo size={28} />
          <span className="min-w-0 truncate font-semibold text-navy">{title}</span>
        </div>
        <main className="mx-auto max-w-5xl p-3 sm:p-4 md:p-6">{children}</main>
      </div>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
      {editingName && <ProfileNameDialog onClose={() => setEditingName(false)} />}
    </div>
  );
}
