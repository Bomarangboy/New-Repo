import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-500">
        <Icon className="size-7" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="mt-2 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const TONES = {
  neutral: "bg-slate-100 text-slate-700",
  blue: "bg-brand-50 text-brand-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  purple: "bg-violet-50 text-violet-700",
} as const;

export function Badge({ tone = "neutral", children, dot = false }: { tone?: keyof typeof TONES; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge ${TONES[tone]}`}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {typeof children === "string" ? children.charAt(0).toUpperCase() + children.slice(1) : children}
    </span>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Honest placeholder for a metric that has no data source yet — never shows a fake zero. */
export function StatCard({ icon: Icon, label, value, note, tone = "blue" }: { icon: LucideIcon; label: string; value: string | null; note?: string; tone?: "blue" | "green" | "purple" | "amber" }) {
  const toneCls = { blue: "bg-brand-50 text-brand-500", green: "bg-emerald-50 text-emerald-600", purple: "bg-violet-50 text-violet-600", amber: "bg-amber-50 text-amber-600" }[tone];
  return (
    <div className="card flex items-start gap-4 p-5">
      <span className={`grid size-12 shrink-0 place-items-center rounded-full ${toneCls}`}>
        <Icon className="size-6" />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-muted">{label}</p>
        <p className={`mt-1 font-bold tracking-tight ${value == null ? "text-base text-slate-400" : "text-3xl"}`}>{value ?? "No data yet"}</p>
        {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      </div>
    </div>
  );
}

export const LIFECYCLE_TONES = { onboarding: "blue", active: "green", paused: "amber", churned: "red", archived: "neutral" } as const;
