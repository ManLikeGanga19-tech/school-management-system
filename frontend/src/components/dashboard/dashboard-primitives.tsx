import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, BadgeCheck } from "lucide-react";

import { cn } from "@/lib/utils";

type DashboardTone = "accent" | "secondary" | "sage" | "warning" | "neutral" | "danger";

const toneMap: Record<
  DashboardTone,
  {
    statWrap: string;
    iconWrap: string;
    value: string;
    sub: string;
    badge: string;
    moduleIcon: string;
  }
> = {
  accent: {
    statWrap: "border-[#ebd3c3] bg-[#f7e7dc]",
    iconWrap: "bg-[#f1d3c0] text-[#9c4828]",
    value: "text-[#743116]",
    sub: "text-[#9c5a37]",
    badge: "border-[#e6c4ad] bg-[#fbf1ea] text-[#93411f]",
    moduleIcon: "bg-[#f3ddd0] text-[#a14b29]",
  },
  secondary: {
    statWrap: "border-[#cedfe1] bg-[#e9f1f2]",
    iconWrap: "bg-[#d7e6e8] text-[#173f49]",
    value: "text-[#173f49]",
    sub: "text-[#41636d]",
    badge: "border-[#c9dadd] bg-[#f0f5f6] text-[#173f49]",
    moduleIcon: "bg-[#dce9eb] text-[#173f49]",
  },
  sage: {
    statWrap: "border-[#d8e8df] bg-[#edf6f0]",
    iconWrap: "bg-[#d6e8dd] text-[#20644f]",
    value: "text-[#1f604d]",
    sub: "text-[#4f7a68]",
    badge: "border-[#cfe4d8] bg-[#f2f8f4] text-[#20644f]",
    moduleIcon: "bg-[#dbece2] text-[#20644f]",
  },
  warning: {
    statWrap: "border-[#ead9bb] bg-[#f8efdf]",
    iconWrap: "bg-[#f0e0bf] text-[#8b5a17]",
    value: "text-[#7a4d12]",
    sub: "text-[#9c6a28]",
    badge: "border-[#e5d1ac] bg-[#fbf6eb] text-[#8b5a17]",
    moduleIcon: "bg-[#f3e5c8] text-[#8b5a17]",
  },
  neutral: {
    statWrap: "border-[#e1d5c2] bg-[#f7f3ec]",
    iconWrap: "bg-[#ece4d7] text-[#4e5f6a]",
    value: "text-[#21323a]",
    sub: "text-[#6b7580]",
    badge: "border-[#ddd0ba] bg-[#faf7f1] text-[#445661]",
    moduleIcon: "bg-[#ede5d8] text-[#445661]",
  },
  danger: {
    statWrap: "border-[#edd0ca] bg-[#faece9]",
    iconWrap: "bg-[#f3dad4] text-[#a24d35]",
    value: "text-[#893821]",
    sub: "text-[#ab5b45]",
    badge: "border-[#e7c2ba] bg-[#fcf1ee] text-[#a24d35]",
    moduleIcon: "bg-[#f2dbd5] text-[#a24d35]",
  },
};

export function dashboardBadgeClasses(tone: DashboardTone = "neutral") {
  return cn(
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
    toneMap[tone].badge
  );
}

export function DashboardSectionLabel({
  children,
  className,
  icon: Icon = BadgeCheck,
}: {
  children: React.ReactNode;
  className?: string;
  icon?: LucideIcon;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-[#dac9b3] bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#55626b] shadow-sm backdrop-blur",
        className
      )}
    >
      <Icon className="size-3.5 text-[#b9512d]" />
      {children}
    </span>
  );
}

export function DashboardStatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  loading = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  tone?: DashboardTone;
  loading?: boolean;
}) {
  const palette = toneMap[tone];

  return (
    <div
      className={cn(
        "rounded-[1.6rem] border p-5 shadow-[0_16px_50px_rgba(15,23,42,0.06)] backdrop-blur",
        palette.statWrap
      )}
    >
      <div className={cn("inline-flex rounded-2xl p-2.5", palette.iconWrap)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className={cn("mt-4 text-2xl font-semibold tracking-tight", palette.value)}>
        {loading ? "—" : value}
      </div>
      <div className="mt-1 text-sm font-medium text-[#44545e]">{label}</div>
      {sub ? <div className={cn("mt-1 text-xs", palette.sub)}>{sub}</div> : null}
    </div>
  );
}

export function DashboardModuleCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
  tone = "neutral",
  badgeTone,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  tone?: DashboardTone;
  badgeTone?: DashboardTone;
}) {
  const palette = toneMap[tone];

  return (
    <Link
      href={href}
      className="group flex h-full flex-col gap-4 rounded-[1.6rem] border border-[#e2d4bf] bg-white/88 p-5 shadow-[0_16px_50px_rgba(15,23,42,0.06)] backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:border-[#d7b699] hover:shadow-[0_20px_60px_rgba(15,23,42,0.1)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("inline-flex rounded-2xl p-2.5 transition group-hover:scale-[1.03]", palette.moduleIcon)}>
          <Icon className="h-5 w-5" />
        </div>
        {badge ? <span className={dashboardBadgeClasses(badgeTone || tone)}>{badge}</span> : null}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1 text-sm font-semibold text-[#132129] transition group-hover:text-[#173f49]">
          {title}
          <ArrowRight className="size-3.5 translate-x-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
        </div>
        <p className="text-xs leading-relaxed text-[#6a747d]">{description}</p>
      </div>
    </Link>
  );
}
