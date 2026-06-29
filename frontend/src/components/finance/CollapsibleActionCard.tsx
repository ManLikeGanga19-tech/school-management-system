"use client";

/**
 * CollapsibleActionCard
 *
 * Wrapper for chunky finance action panels (bulk-generate, publish-all-drafts)
 * so they collapse to a single header row by default. Header stays useful even
 * when collapsed: title, subtitle, an optional badge (eg. live draft count),
 * and a chevron showing state. Click anywhere on the header to toggle.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Right-side header chip — e.g. "3 drafts ready" */
  badge?: ReactNode;
  /** Whether the panel starts expanded. Defaults to false (collapsed). */
  defaultOpen?: boolean;
  children: ReactNode;
};

export function CollapsibleActionCard({
  title,
  subtitle,
  icon: Icon,
  badge,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="dashboard-surface overflow-hidden rounded-[1.6rem]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-slate-50/60 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400" />}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-slate-400">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {badge && <div className="hidden sm:flex">{badge}</div>}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-slate-400 transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </button>
      {open && (
        <div className="border-t border-[#eadfce] p-4 sm:p-6">{children}</div>
      )}
    </div>
  );
}
