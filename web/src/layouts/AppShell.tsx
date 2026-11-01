import { KeyRound, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { ChangePasswordDialog } from "../components/ChangePasswordDialog";
import { Logo } from "../components/ui";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export function AppShell({ nav, title, header, children }: {
  nav: NavItem[];
  title: string;
  header?: ReactNode;
  children: ReactNode;
}) {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <div className="min-h-screen md:flex">
      <aside
        className={`bg-navy text-white md:sticky md:top-0 md:flex md:h-screen md:w-60 md:flex-col ${open ? "flex flex-col" : "hidden"}`}
      >
        <div className="hidden items-center gap-3 p-4 md:flex">
          <Logo />
          <span className="truncate font-semibold">{title}</span>
        </div>
        {header && <div className="px-3 pb-2">{header}</div>}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-primary" : "text-white/80 hover:bg-white/10"}`
              }
            >
              <Icon size={18} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <p className="truncate px-3 pb-2 text-sm text-white/70">{me?.user.full_name || me?.user.phone}</p>
          <button
            onClick={() => setChangingPassword(true)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            <KeyRound size={18} aria-hidden />
            Parolni o'zgartirish
          </button>
          <button
            onClick={() => void signOut()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            <LogOut size={18} aria-hidden />
            Chiqish
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3 md:hidden">
          <button onClick={() => setOpen(!open)} aria-label="Menyu" aria-expanded={open}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
          <span className="truncate font-semibold text-navy">{title}</span>
        </div>
        <main className="mx-auto max-w-5xl p-4 md:p-6">{children}</main>
      </div>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
