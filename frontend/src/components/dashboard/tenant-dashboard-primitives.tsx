import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Tenant "Warm Prestige" dashboard primitives — the school-facing counterpart to
 * admin-primitives, in the gold/orange tenant palette. Same prop API as the
 * shared dashboard-primitives so role dashboards swap by import path only.
 * Flat white cards, hairline borders, one restrained accent per tone. UI only.
 *
 * Must render inside a `.tenant-theme` scope for the tokens to resolve.
 */

type DashboardTone = "accent" | "secondary" | "sage" | "warning" | "neutral" | "danger";

const tone: Record<DashboardTone, { sub: string; chip: string; dot: string }> = {
  accent:    { sub: "text-[#a85410]", chip: "bg-[var(--tenant-primary-soft)] text-[#a85410]", dot: "bg-[var(--tenant-primary)]" },
  secondary: { sub: "text-[#5b4a34]", chip: "bg-[#f0e9dd] text-[#5b4a34]", dot: "bg-[#5b4a34]" },
  sage:      { sub: "text-[#0f7a5a]", chip: "bg-[#e7f6f0] text-[#0f7a5a]", dot: "bg-[var(--tenant-success)]" },
  warning:   { sub: "text-[#a65f00]", chip: "bg-[#fdf0dc] text-[#b45309]", dot: "bg-[var(--tenant-warning)]" },
  neutral:   { sub: "text-[#78716c]", chip: "bg-[var(--tenant-surface-2)] text-[#5b4a34]", dot: "bg-[#a8a29e]" },
  danger:    { sub: "text-[#b42318]", chip: "bg-[#fdecec] text-[var(--tenant-error)]", dot: "bg-[var(--tenant-error)]" },
};

const CARD = "rounded-xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] shadow-[0_1px_2px_rgba(51,36,15,0.05)]";

export function dashboardBadgeClasses(t: DashboardTone = "neutral") {
  return cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold", tone[t].chip);
}

export function DashboardSectionLabel({ children }: { children: React.ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <h2 className="font-serif mb-4 text-lg font-bold tracking-tight text-[var(--tenant-ink)]">{children}</h2>
  );
}

export function DashboardStatCard({
  label, value, sub, icon: Icon, tone: t = "neutral", loading = false,
}: {
  label: string; value: string | number; sub?: string; icon: LucideIcon;
  tone?: DashboardTone; loading?: boolean;
}) {
  return (
    <div className={cn(CARD, "p-5")}>
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tenant-muted)]">{label}</div>
        <Icon className="h-4 w-4 shrink-0 text-[var(--tenant-muted)]/50" />
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight text-[var(--tenant-ink)]">
        {loading ? <span className="text-[var(--tenant-muted)]/40">—</span> : value}
      </div>
      {sub ? <div className={cn("mt-1 text-xs font-medium", tone[t].sub)}>{sub}</div> : null}
    </div>
  );
}

export function DashboardModuleCard({
  href, icon: Icon, title, description, badge, tone: t = "neutral", badgeTone,
}: {
  href: string; icon: LucideIcon; title: string; description: string;
  badge?: string; tone?: DashboardTone; badgeTone?: DashboardTone;
}) {
  return (
    <Link
      href={href}
      className={cn(
        CARD,
        "group flex h-full flex-col gap-4 p-5 transition-all duration-150 hover:border-[var(--tenant-primary)] hover:shadow-[0_8px_24px_rgba(51,36,15,0.08)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Uniform icon chip across every module card — no per-tone rainbow. */}
        <div className="inline-flex rounded-lg bg-[var(--tenant-surface-2)] p-2.5 text-[#5b4a34]">
          <Icon className="h-5 w-5" />
        </div>
        {badge ? <span className={dashboardBadgeClasses(badgeTone || t)}>{badge}</span> : null}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-1 font-semibold text-[var(--tenant-ink)]">
          {title}
          <ArrowUpRight className="h-4 w-4 opacity-0 transition-all group-hover:opacity-100 text-[var(--tenant-primary)]" />
        </div>
        <p className="text-xs leading-relaxed text-[var(--tenant-muted)]">{description}</p>
      </div>
    </Link>
  );
}

/** Titled surface container for grouping dashboard content (tables, lists). */
export function DashboardPanel({
  title, action, children, className,
}: {
  title?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn(CARD, "overflow-hidden", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--tenant-border)] px-5 py-3.5">
          {typeof title === "string"
            ? <h3 className="font-serif text-base font-bold tracking-tight text-[var(--tenant-ink)]">{title}</h3>
            : title}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
