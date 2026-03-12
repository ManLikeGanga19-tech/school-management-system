import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type SaasPageHeaderBadge = {
  label: string;
  icon?: LucideIcon;
};

type SaasPageHeaderMetric = {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "warning";
};

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
    metrics.length >= 4
      ? "grid-cols-2 sm:grid-cols-4"
      : metrics.length === 3
        ? "grid-cols-2 sm:grid-cols-3"
        : "grid-cols-2";

  return (
    <div className={cn("dashboard-hero rounded-[2rem] p-6 text-white", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {badges.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {badges.map(({ label, icon: Icon }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white/90 backdrop-blur"
                >
                  {Icon ? <Icon className="h-3 w-3" /> : null}
                  {label}
                </span>
              ))}
            </div>
          ) : null}
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-white/75">{description}</p>
        </div>

        {metrics.length > 0 || actions ? (
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[20rem] sm:items-end">
            {metrics.length > 0 ? (
              <div
                className={cn(
                  "grid w-full gap-2 text-center",
                  metricsGridClass
                )}
              >
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className={cn(
                      "rounded-xl px-3 py-2 backdrop-blur",
                      metric.tone === "warning" ? "bg-[#a24d35]/35 text-[#fff6f2]" : "bg-white/10 text-white"
                    )}
                  >
                    <div className="text-lg font-bold sm:text-xl">{metric.value}</div>
                    <div className="text-xs text-white/70">{metric.label}</div>
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
        muted ? "dashboard-surface-muted" : "dashboard-surface",
        "rounded-[1.6rem]",
        className
      )}
    >
      {children}
    </div>
  );
}
