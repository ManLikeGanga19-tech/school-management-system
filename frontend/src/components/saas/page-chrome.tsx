import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared chrome for /saas pages — restyled to the v2 "Prestige Professional"
 * admin system (flat white surfaces, hairline borders, serif headings, gold/
 * slate accents). Same prop API as before, so every page using it converts
 * automatically. UI only — no data/route changes.
 */

type SaasPageHeaderBadge = { label: string; icon?: LucideIcon };
type SaasPageHeaderMetric = { label: string; value: React.ReactNode; tone?: "default" | "warning" };

export function SaasPageHeader({
  title,
  description,
  badges = [],
  metrics = [],
  actions,
  className,
}: {
  title: string;
  description: string;
  badges?: SaasPageHeaderBadge[];
  metrics?: SaasPageHeaderMetric[];
  actions?: ReactNode;
  className?: string;
}) {
  const metricsGridClass =
    metrics.length >= 4 ? "grid-cols-2 sm:grid-cols-4"
      : metrics.length === 3 ? "grid-cols-2 sm:grid-cols-3"
        : "grid-cols-2";

  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 shadow-[0_1px_2px_rgba(19,33,41,0.05)]",
        className
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {badges.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {badges.map(({ label, icon: Icon }, i) => (
                <span
                  key={label}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold",
                    i === 0
                      ? "bg-[var(--admin-primary)] text-white"
                      : "bg-[var(--admin-surface-2)] font-medium text-[var(--admin-muted)]"
                  )}
                >
                  {Icon ? <Icon className={cn("h-3 w-3", i === 0 && "text-[var(--admin-gold)]")} /> : null}
                  {label}
                </span>
              ))}
            </div>
          ) : null}
          <h1 className="font-serif text-2xl font-bold tracking-tight text-[var(--admin-ink)]">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--admin-muted)]">{description}</p>
        </div>

        {metrics.length > 0 || actions ? (
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[20rem] sm:items-end">
            {metrics.length > 0 ? (
              <div className={cn("grid w-full gap-2 text-center", metricsGridClass)}>
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2"
                  >
                    <div
                      className={cn(
                        "text-lg font-bold sm:text-xl",
                        metric.tone === "warning" ? "text-[var(--admin-error)]" : "text-[var(--admin-ink)]"
                      )}
                    >
                      {metric.value}
                    </div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--admin-muted)]">{metric.label}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {actions ? <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">{actions}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SaasSurface({
  children,
  className,
  muted = false,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--admin-border)] shadow-[0_1px_2px_rgba(19,33,41,0.05)]",
        muted ? "bg-[var(--admin-surface-2)]" : "bg-[var(--admin-surface)]",
        className
      )}
    >
      {children}
    </div>
  );
}
