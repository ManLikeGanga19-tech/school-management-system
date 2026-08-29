import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Admin ("Prestige Professional") dashboard primitives — same prop API as the
 * shared dashboard-primitives, so admin screens swap by import path only and the
 * tenant dashboards keep their own look. Flat white cards, hairline borders,
 * one restrained accent per tone. UI only.
 */

type DashboardTone = "accent" | "secondary" | "sage" | "warning" | "neutral" | "danger";

const tone: Record<DashboardTone, { sub: string; chip: string; dot: string }> = {
  accent:    { sub: "text-[#8a6d00]", chip: "bg-[#fbf3d7] text-[#8a6d00]", dot: "bg-[var(--admin-gold)]" },
  secondary: { sub: "text-[#43474a]", chip: "bg-[#eef1f2] text-[#2f3e46]", dot: "bg-[#2f3e46]" },
  sage:      { sub: "text-[#0f7a5a]", chip: "bg-[#e7f6f0] text-[#0f7a5a]", dot: "bg-[var(--admin-success)]" },
  warning:   { sub: "text-[#a65f00]", chip: "bg-[#fdf0dc] text-[#b45309]", dot: "bg-[var(--admin-warning)]" },
  neutral:   { sub: "text-[#6b7280]", chip: "bg-[#f3f4f5] text-[#43474a]", dot: "bg-[#9ca3af]" },
  danger:    { sub: "text-[#b42318]", chip: "bg-[#fdecec] text-[var(--admin-error)]", dot: "bg-[var(--admin-error)]" },
};

const CARD = "rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-[0_1px_2px_rgba(19,33,41,0.05)]";

export function dashboardBadgeClasses(t: DashboardTone = "neutral") {
  return cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold", tone[t].chip);
}

export function DashboardSectionLabel({ children }: { children: React.ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <h2 className="font-serif mb-4 text-lg font-bold tracking-tight text-[var(--admin-ink)]">{children}</h2>
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
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--admin-muted)]">{label}</div>
        <Icon className="h-4 w-4 shrink-0 text-[var(--admin-muted)]/50" />
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight text-[var(--admin-ink)]">
        {loading ? <span className="text-[var(--admin-muted)]/40">—</span> : value}
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
        "group flex h-full flex-col gap-4 p-5 transition-all duration-150 hover:border-[var(--admin-gold)] hover:shadow-[0_8px_24px_rgba(19,33,41,0.08)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Uniform icon chip across every module card — no per-tone rainbow. */}
        <div className="inline-flex rounded-lg bg-[var(--admin-surface-2)] p-2.5 text-[var(--admin-slate)]">
          <Icon className="h-5 w-5" />
        </div>
        {badge ? <span className={dashboardBadgeClasses(badgeTone || t)}>{badge}</span> : null}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-1 font-semibold text-[var(--admin-ink)]">
          {title}
          <ArrowUpRight className="h-4 w-4 opacity-0 transition-all group-hover:opacity-100 text-[var(--admin-gold)]" />
        </div>
        <p className="text-xs leading-relaxed text-[var(--admin-muted)]">{description}</p>
      </div>
    </Link>
  );
}
