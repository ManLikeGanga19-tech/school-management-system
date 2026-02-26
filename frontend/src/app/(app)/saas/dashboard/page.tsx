"use client";

import RequireAuth from "@/components/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  Building2,
  CheckCircle,
  XCircle,
  TrendingUp,
  Users,
  ShieldCheck,
  ClipboardList,
  CreditCard,
  AlertTriangle,
  RefreshCw,
  Activity,
  Globe,
  Layers,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

type SaaSSummary = {
  total_tenants: number;
  active_tenants: number;
  inactive_tenants: number;
};

type SaaSMetrics = {
  revenue: {
    mrr: number;
    arr: number;
    total_collected: number;
    growth_percent: number;
  };
  subscriptions: {
    active: number;
    trialing: number;
    past_due: number;
    cancelled: number;
    plans: { name: string; count: number; price: number }[];
  };
  tenants: {
    new_this_month: number;
    churned_this_month: number;
    total_users_across_tenants: number;
  };
  system: {
    total_enrollments: number;
    total_invoices: number;
    total_audit_events: number;
    total_permissions: number;
    total_roles: number;
  };
};

type RecentTenant = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  plan?: string;
  user_count?: number;
  created_at: string;
  last_activity?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatKes(value: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

function timeAgo(iso?: string) {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function avatarColor(id: string) {
  const palette = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-purple-100 text-purple-700",
    "bg-rose-100 text-rose-700",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "emerald" | "amber" | "slate" | "purple" | "red";
  loading?: boolean;
}) {
  const p = {
    blue: {
      wrap: "border-blue-100 bg-blue-50",
      icon: "bg-blue-100 text-blue-600",
      val: "text-blue-900",
      sub: "text-blue-400",
    },
    emerald: {
      wrap: "border-emerald-100 bg-emerald-50",
      icon: "bg-emerald-100 text-emerald-600",
      val: "text-emerald-900",
      sub: "text-emerald-400",
    },
    amber: {
      wrap: "border-amber-100 bg-amber-50",
      icon: "bg-amber-100 text-amber-600",
      val: "text-amber-900",
      sub: "text-amber-400",
    },
    slate: {
      wrap: "border-slate-100 bg-slate-50",
      icon: "bg-slate-100 text-slate-500",
      val: "text-slate-900",
      sub: "text-slate-400",
    },
    purple: {
      wrap: "border-purple-100 bg-purple-50",
      icon: "bg-purple-100 text-purple-600",
      val: "text-purple-900",
      sub: "text-purple-400",
    },
    red: {
      wrap: "border-red-100 bg-red-50",
      icon: "bg-red-100 text-red-600",
      val: "text-red-900",
      sub: "text-red-400",
    },
  }[color];

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${p.wrap}`}>
      <div className={`inline-flex rounded-xl p-2.5 ${p.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      {loading ? (
        <Skeleton className="mt-4 h-8 w-28" />
      ) : (
        <div className={`mt-4 text-2xl font-bold tracking-tight ${p.val}`}>{value}</div>
      )}
      <div className="mt-0.5 text-sm font-medium text-slate-600">{label}</div>
      {sub && <div className={`mt-0.5 text-xs ${p.sub}`}>{sub}</div>}
    </div>
  );
}

function ModuleCard({
  href,
  icon: Icon,
  iconColor,
  title,
  description,
  badge,
  badgeColor,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  title: string;
  description: string;
  badge?: string;
  badgeColor?: "blue" | "emerald" | "amber" | "slate" | "purple" | "red";
}) {
  const badgeColors = {
    blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    slate: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    purple: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
    red: "bg-red-50 text-red-700 ring-1 ring-red-200",
  };

  return (
    <a
      href={href}
      className="group flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div className={`inline-flex rounded-xl p-2.5 transition group-hover:opacity-90 ${iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
        {badge && badgeColor && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeColors[badgeColor]}`}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <div className="flex items-center gap-1 text-sm font-semibold text-slate-900 transition group-hover:text-blue-700">
          {title}
          <span className="translate-x-0 opacity-0 transition-all group-hover:translate-x-1 group-hover:opacity-100">
            →
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
      </div>
    </a>
  );
}

// ─── Nav config ───────────────────────────────────────────────────────────────

const nav = [
  { href: "/saas/dashboard", label: "SaaS Summary" },
  { href: "/saas/tenants", label: "Tenants" },
  { href: "/saas/subscriptions", label: "Subscriptions" },
  { href: "/saas/rbac/permissions", label: "Permissions" },
  { href: "/saas/rbac/roles", label: "Roles" },
  { href: "/saas/audit", label: "Audit Logs" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaaSDashboardPage() {
  const [summary, setSummary] = useState<SaaSSummary | null>(null);
  const [metrics, setMetrics] = useState<SaaSMetrics | null>(null);
  const [tenants, setTenants] = useState<RecentTenant[]>([]);
  const [error, setError] = useState<string | null>(null);

  // More production-safe loading states (no flicker, SWR style)
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Prevent state updates after unmount + prevent overlapping fetches
  const mountedRef = useRef(true);
  const inflightRef = useRef(false);

  const activeRate = useMemo(() => {
    if (!summary || summary.total_tenants <= 0) return 0;
    return Math.round((summary.active_tenants / summary.total_tenants) * 100);
  }, [summary]);

  const pastDueCount = metrics?.subscriptions?.past_due ?? 0;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);

    if (!mountedRef.current) return;
    if (inflightRef.current) return; // avoid overlapping calls
    inflightRef.current = true;

    if (silent) setRefreshing(true);
    else setInitialLoading(true);

    // Clear only “hard” errors on a fresh manual load; keep UI stable on silent refresh
    if (!silent) setError(null);

    try {
      // Run requests concurrently; allow partial success (enterprise-grade resiliency)
      const [summaryRes, metricsRes, tenantsRes] = await Promise.allSettled([
        apiFetch<SaaSSummary>("/admin/saas/summary", { method: "GET", tenantRequired: false }),
        apiFetch<SaaSMetrics>("/admin/saas/metrics", { method: "GET", tenantRequired: false }),
        apiFetch<{ tenants: RecentTenant[] }>("/admin/saas/tenants/recent", {
          method: "GET",
          tenantRequired: false,
        }),
      ]);

      if (!mountedRef.current) return;

      // Summary (required for dashboard)
      if (summaryRes.status === "fulfilled") {
        setSummary(summaryRes.value);
      } else if (!silent) {
        setError(summaryRes.reason?.message ?? "Failed to load SaaS summary");
      }

      // Metrics (optional but should not crash page)
      if (metricsRes.status === "fulfilled") {
        setMetrics(metricsRes.value);
      } else {
        // Don’t hard-error page; keep previous metrics if any.
        // If you want to surface a soft warning later, add a “metricsWarning” state.
      }

      // Recent tenants (optional)
      if (tenantsRes.status === "fulfilled") {
        setTenants(tenantsRes.value?.tenants ?? []);
      } else {
        // silent degrade
      }

      setLastUpdated(new Date());
    } finally {
      inflightRef.current = false;
      if (!mountedRef.current) return;
      setRefreshing(false);
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load({ silent: false });

    // Background refresh (SWR-like) — safe + low frequency
    const timer = setInterval(() => void load({ silent: true }), 30_000);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [load]);

  const headerLoading = initialLoading && !summary;
  const kpiLoading = initialLoading && !metrics;

  return (
    <RequireAuth mode="saas">
      <AppShell title="Super Admin" nav={nav}>
        <div className="space-y-5">
          {/* ── Header ── */}
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-700 via-blue-600 to-blue-500 p-6 text-white shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                    <ShieldCheck className="h-3 w-3" />
                    Super Admin
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-blue-100">
                    <Globe className="h-3 w-3" />
                    Platform Level
                  </span>
                </div>
                <h1 className="text-2xl font-bold">SaaS Control Centre</h1>
                <p className="mt-0.5 text-sm text-blue-100">
                  Platform-wide overview — tenants, subscriptions, revenue &amp; system health
                </p>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: "Total Tenants", value: summary?.total_tenants ?? "—" },
                    { label: "Active", value: summary?.active_tenants ?? "—" },
                    { label: "Inactive", value: summary?.inactive_tenants ?? "—" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-white/10 px-4 py-2 backdrop-blur">
                      {headerLoading ? (
                        <Skeleton className="mx-auto h-6 w-10 bg-white/20" />
                      ) : (
                        <div className="text-xl font-bold text-white">{item.value}</div>
                      )}
                      <div className="text-xs text-blue-200">{item.label}</div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  {lastUpdated && (
                    <span className="text-xs text-blue-200">
                      Updated {timeAgo(lastUpdated.toISOString())}
                    </span>
                  )}

                  <button
                    onClick={() => void load({ silent: true })}
                    className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-60"
                    disabled={refreshing}
                    aria-busy={refreshing}
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                    {refreshing ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Alerts ── */}
          {error && (
            <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                {error}
              </div>
              <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">
                ✕
              </button>
            </div>
          )}

          {pastDueCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
              <span>
                <strong>{pastDueCount}</strong> subscription{pastDueCount !== 1 ? "s are" : " is"} past due.{" "}
                <a href="/saas/subscriptions" className="font-semibold underline hover:no-underline">
                  Review now →
                </a>
              </span>
            </div>
          )}

          {/* ── Revenue KPIs ── */}
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Revenue</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Monthly Recurring Revenue"
                value={metrics ? formatKes(metrics.revenue.mrr) : "—"}
                sub={
                  metrics
                    ? `${metrics.revenue.growth_percent > 0 ? "+" : ""}${metrics.revenue.growth_percent}% MoM`
                    : "Loading metrics…"
                }
                icon={TrendingUp}
                color="emerald"
                loading={kpiLoading}
              />
              <StatCard
                label="Annual Run Rate"
                value={metrics ? formatKes(metrics.revenue.arr) : "—"}
                sub="ARR based on current MRR"
                icon={CreditCard}
                color="blue"
                loading={kpiLoading}
              />
              <StatCard
                label="Active Subscriptions"
                value={metrics?.subscriptions.active ?? "—"}
                sub={metrics ? `${metrics.subscriptions.trialing} trialling` : ""}
                icon={CheckCircle}
                color="emerald"
                loading={kpiLoading}
              />
              <StatCard
                label="Past Due"
                value={metrics?.subscriptions.past_due ?? "—"}
                sub={metrics ? `${metrics.subscriptions.cancelled} cancelled` : ""}
                icon={AlertTriangle}
                color={pastDueCount > 0 ? "red" : "slate"}
                loading={kpiLoading}
              />
            </div>
          </div>

          {/* ── Tenant KPIs ── */}
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Tenants &amp; Users
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Total Tenants"
                value={summary?.total_tenants ?? "—"}
                sub={`${activeRate}% active`}
                icon={Building2}
                color="blue"
                loading={initialLoading && !summary}
              />
              <StatCard
                label="Active Tenants"
                value={summary?.active_tenants ?? "—"}
                sub={metrics ? `${metrics.tenants.new_this_month} new this month` : ""}
                icon={Activity}
                color="emerald"
                loading={initialLoading && !summary}
              />
              <StatCard
                label="Inactive Tenants"
                value={summary?.inactive_tenants ?? "—"}
                sub={metrics ? `${metrics.tenants.churned_this_month} churned this month` : ""}
                icon={XCircle}
                color={summary && summary.inactive_tenants > 0 ? "amber" : "slate"}
                loading={initialLoading && !summary}
              />
              <StatCard
                label="Total Users (All Tenants)"
                value={metrics?.tenants.total_users_across_tenants ?? "—"}
                sub="Across all tenants"
                icon={Users}
                color="purple"
                loading={kpiLoading}
              />
            </div>
          </div>

          {/* ── System stats ── */}
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Platform Data
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                {
                  label: "Enrollments",
                  value: metrics?.system.total_enrollments ?? "—",
                  color: "border-blue-100 bg-blue-50 text-blue-900 text-blue-400",
                },
                {
                  label: "Invoices",
                  value: metrics?.system.total_invoices ?? "—",
                  color: "border-emerald-100 bg-emerald-50 text-emerald-900 text-emerald-400",
                },
                {
                  label: "Audit Events",
                  value: metrics?.system.total_audit_events ?? "—",
                  color: "border-slate-100 bg-slate-50 text-slate-900 text-slate-400",
                },
                {
                  label: "Permissions",
                  value: metrics?.system.total_permissions ?? "—",
                  color: "border-purple-100 bg-purple-50 text-purple-900 text-purple-400",
                },
                {
                  label: "Roles",
                  value: metrics?.system.total_roles ?? "—",
                  color: "border-amber-100 bg-amber-50 text-amber-900 text-amber-400",
                },
              ].map((item) => {
                const [border, bg, textVal, textSub] = item.color.split(" ");
                return (
                  <div key={item.label} className={`rounded-xl border px-4 py-3 ${border} ${bg}`}>
                    {kpiLoading ? (
                      <Skeleton className="h-6 w-16" />
                    ) : (
                      <div className={`text-xl font-bold ${textVal}`}>{item.value}</div>
                    )}
                    <div className={`text-xs font-medium ${textSub}`}>{item.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Subscription plan breakdown + Recent tenants ── */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Subscription plans */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-slate-400" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Subscription Plans</h2>
                    <p className="mt-0.5 text-xs text-slate-400">Tenant distribution across pricing tiers</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                {!metrics ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <Layers className="h-8 w-8 text-slate-200" />
                    <p className="text-sm text-slate-400">{kpiLoading ? "Loading…" : "No metrics yet"}</p>
                    <p className="text-xs text-slate-300 max-w-xs">
                      Ensure{" "}
                      <code className="rounded bg-slate-100 px-1">GET /api/v1/admin/saas/metrics</code>{" "}
                      is enabled and permissions allow access.
                    </p>
                  </div>
                ) : metrics.subscriptions.plans.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">No plans configured yet.</p>
                ) : (
                  <div className="space-y-3">
                    {metrics.subscriptions.plans.map((plan) => {
                      const pct =
                        metrics.subscriptions.active > 0
                          ? Math.round((plan.count / metrics.subscriptions.active) * 100)
                          : 0;
                      return (
                        <div key={plan.name}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-800">{plan.name}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                                {plan.count} tenant{plan.count !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-slate-400">{pct}%</span>
                              <span className="text-xs font-semibold text-slate-700">
                                {formatKes(plan.price)}/mo
                              </span>
                            </div>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-blue-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Recent tenants */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Recent Tenants</h2>
                    <p className="mt-0.5 text-xs text-slate-400">Latest onboarded institutions</p>
                  </div>
                </div>
                <a href="/saas/tenants" className="text-xs font-medium text-blue-600 hover:underline">
                  View all →
                </a>
              </div>

              <div className="divide-y divide-slate-100">
                {tenants.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <Building2 className="h-8 w-8 text-slate-200" />
                    <p className="text-sm text-slate-400">{initialLoading ? "Loading…" : "No recent tenants"}</p>
                    <p className="text-xs text-slate-300 max-w-xs">
                      Endpoint:{" "}
                      <code className="rounded bg-slate-100 px-1">GET /api/v1/admin/saas/tenants/recent</code>
                    </p>
                  </div>
                ) : (
                  tenants.slice(0, 6).map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(
                          t.id
                        )}`}
                      >
                        {t.name[0]?.toUpperCase() ?? "T"}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 truncate">{t.name}</span>
                          {t.plan && (
                            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600">
                              {t.plan}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="font-mono">{t.slug}</span>
                          {t.user_count !== undefined && (
                            <span>
                              · {t.user_count} user{t.user_count !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            t.is_active
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${t.is_active ? "bg-emerald-500" : "bg-slate-400"}`}
                          />
                          {t.is_active ? "Active" : "Inactive"}
                        </span>
                        <span className="text-xs text-slate-400">
                          {timeAgo(t.last_activity ?? t.created_at)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Module quick links ── */}
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Admin Modules</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ModuleCard
                href="/saas/tenants"
                icon={Building2}
                iconColor="bg-blue-50 text-blue-600"
                title="Tenants"
                description="Onboard, configure, activate or suspend tenant institutions across the platform."
                badge={`${summary?.total_tenants ?? 0} total`}
                badgeColor="blue"
              />
              <ModuleCard
                href="/saas/subscriptions"
                icon={CreditCard}
                iconColor="bg-emerald-50 text-emerald-600"
                title="Subscriptions"
                description="Manage billing plans, payment status, trial periods, and renewal schedules."
                badge={pastDueCount > 0 ? `${pastDueCount} past due` : "Up to date"}
                badgeColor={pastDueCount > 0 ? "red" : "emerald"}
              />
              <ModuleCard
                href="/saas/rbac/permissions"
                icon={ShieldCheck}
                iconColor="bg-purple-50 text-purple-600"
                title="Permissions"
                description="Define system-wide permission codes available to all tenant roles and overrides."
                badge={metrics ? `${metrics.system.total_permissions} defined` : undefined}
                badgeColor="purple"
              />
              <ModuleCard
                href="/saas/rbac/roles"
                icon={Layers}
                iconColor="bg-amber-50 text-amber-600"
                title="Roles"
                description="Create and manage global role templates that tenant directors can assign to users."
                badge={metrics ? `${metrics.system.total_roles} roles` : undefined}
                badgeColor="amber"
              />
              <ModuleCard
                href="/saas/audit"
                icon={ClipboardList}
                iconColor="bg-slate-100 text-slate-600"
                title="Audit Logs"
                description="Platform-wide audit trail across all tenants, actions, and system events."
                badge={metrics ? `${metrics.system.total_audit_events} events` : undefined}
                badgeColor="slate"
              />
              <ModuleCard
                href="/saas/users"
                icon={Users}
                iconColor="bg-rose-50 text-rose-600"
                title="Platform Users"
                description="View and manage all user accounts across every tenant on the platform."
                badge={metrics ? `${metrics.tenants.total_users_across_tenants} users` : undefined}
                badgeColor="slate"
              />
            </div>
          </div>
        </div>
      </AppShell>
    </RequireAuth>
  );
}