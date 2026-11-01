import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { ApiError } from "../api/client";

export function Logo({ size = 40 }: { size?: number }) {
  return <img src="/logo.jpg" alt="Chronix" width={size} height={size} className="rounded-lg object-cover" />;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const style = {
    primary: "bg-primary text-white hover:bg-primary-dark",
    secondary: "bg-white text-ink border border-line hover:bg-page",
    danger: "bg-white text-danger border border-danger/40 hover:bg-danger/5",
  }[variant];
  return (
    <button
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${style} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-white p-4 ${className}`}>{children}</section>;
}

export function PageTitle({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-navy">{title}</h1>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </header>
  );
}

export function Badge({ tone, children }: { tone: "green" | "red" | "amber" | "gray"; children: ReactNode }) {
  const style = {
    green: "bg-success/10 text-success",
    red: "bg-danger/10 text-danger",
    amber: "bg-warning/10 text-warning",
    gray: "bg-line text-muted",
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{children}</span>;
}

export function Spinner() {
  return (
    <div className="flex justify-center p-8 text-muted" role="status" aria-label="Yuklanmoqda">
      <Loader2 className="animate-spin" size={22} />
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof ApiError ? error.message : "Serverga ulanib bo'lmadi. Qayta urinib ko'ring.";
  return (
    <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

export function ComingSoon({ title, plan }: { title: string; plan: string }) {
  return (
    <>
      <PageTitle title={title} />
      <Card>
        <Empty>Bu bo'lim keyingi bosqichda ochiladi. {plan}</Empty>
      </Card>
    </>
  );
}
