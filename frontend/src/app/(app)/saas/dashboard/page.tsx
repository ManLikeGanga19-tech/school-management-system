"use client";

import RequireAuth from "@/components/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import {
  DashboardModuleCard,
  DashboardSectionLabel,
  DashboardStatCard,
  dashboardBadgeClasses,
} from "@/components/dashboard/dashboard-primitives";
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
  HandCoins,
  AlertTriangle,
  RefreshCw,
  Activity,
  Globe,
  Layers,
  CalendarDays,
  Rocket,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";

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

type SaaSPaymentRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  amount_kes: number;
  status: "pending" | "completed" | "failed" | "cancelled";
  billing_plan: "per_term" | "per_year";
  billing_term_label?: string | null;
  paid_at?: string | null;
  created_at: string;
  mpesa_receipt?: string | null;
};

type DarajaPaymentsHealth = {
  status: "ready" | "degraded";
  ready: boolean;
  mode: "sandbox" | "production";
  use_mock: boolean;
  sandbox_fallback_to_mock: boolean;
  timeout_sec: number;
  callback_url: string | null;
  callback_token_protected: boolean;
  missing_required: string[];
  checked_at: string;
};

type DarajaDnsCheck = {
  host: string;
  ok: boolean;
  addresses: string[];
  latency_ms: number | null;
  error: string | null;
};

type DarajaOauthCheck = {
  attempted: boolean;
  ok: boolean;
  latency_ms: number | null;
  error_type: string | null;
  error: string | null;
};

type DarajaConnectivityCheck = {
  status: "healthy" | "degraded" | "misconfigured";
  mode: "sandbox" | "production";
  base_url: string;
  use_mock: boolean;
  sandbox_fallback_to_mock: boolean;
  missing_required: string[];
  dns_checks: DarajaDnsCheck[];
  oauth_check: DarajaOauthCheck;
  recommendation: string;
  checked_at: string;
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
    "bg-[#f3ddd0] text-[#a14b29]",
    "bg-[#dce9eb] text-[#173f49]",
    "bg-[#dbece2] text-[#20644f]",
    "bg-[#f3e5c8] text-[#8b5a17]",
    "bg-[#f2dbd5] text-[#a24d35]",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaaSDashboardPage() {
  const [summary, setSummary] = useState<SaaSSummary | null>(null);
  const [metrics, setMetrics] = useState<SaaSMetrics | null>(null);
  const [tenants, setTenants] = useState<RecentTenant[]>([]);
  const [recentPayments, setRecentPayments] = useState<SaaSPaymentRow[]>([]);
  const [darajaHealth, setDarajaHealth] = useState<DarajaPaymentsHealth | null>(null);
  const [darajaConnectivity, setDarajaConnectivity] = useState<DarajaConnectivityCheck | null>(null);
  const [darajaConnectivityLoading, setDarajaConnectivityLoading] = useState(false);
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

  const runDarajaConnectivityCheck = useCallback(async () => {
    if (darajaConnectivityLoading) return;
    setDarajaConnectivityLoading(true);
    try {
      const result = await apiFetch<DarajaConnectivityCheck>(
        "/admin/saas/payments/health/connectivity?force=true",
        { method: "GET", tenantRequired: false }
      );
      setDarajaConnectivity(result);
      if (result.status === "healthy") {
        toast.success("Daraja connectivity check passed.");
      } else if (result.status === "misconfigured") {
        toast.error("Daraja connectivity check: configuration missing.");
      } else {
        toast.error("Daraja connectivity check: upstream degraded.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to run Daraja connectivity check.");
    } finally {
      setDarajaConnectivityLoading(false);
    }
  }, [darajaConnectivityLoading]);

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
      const [summaryRes, metricsRes, tenantsRes, recentPaymentsRes, darajaHealthRes] = await Promise.allSettled([
        apiFetch<SaaSSummary>("/admin/saas/summary", { method: "GET", tenantRequired: false }),
        apiFetch<SaaSMetrics>("/admin/saas/metrics", { method: "GET", tenantRequired: false }),
        apiFetch<{ tenants: RecentTenant[] }>("/admin/saas/tenants/recent", {
          method: "GET",
          tenantRequired: false,
        }),
        apiFetch<SaaSPaymentRow[]>("/admin/saas/payments/recent?limit=8", {
          method: "GET",
          tenantRequired: false,
        }),
        apiFetch<DarajaPaymentsHealth>("/admin/saas/payments/health", {
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

      if (recentPaymentsRes.status === "fulfilled") {
        setRecentPayments(recentPaymentsRes.value ?? []);
      }

      // Daraja health (optional)
      if (darajaHealthRes.status === "fulfilled") {
        setDarajaHealth(darajaHealthRes.value);
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

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const headerLoading = initialLoading && !summary;
  const kpiLoading = initialLoading && !metrics;

  return (
    <RequireAuth mode="saas">
      <AppShell title="Super Admin" nav={saasNav}>
        <div className="space-y-5">
          {/* ── Header ── */}
          <div className="dashboard-hero rounded-[2rem] p-6 text-white">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                    <ShieldCheck className="h-3 w-3" />
                    Super Admin
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/80">
                    <Globe className="h-3 w-3" />
                    Platform Level
                  </span>
                </div>
                <h1 className="text-2xl font-bold">SaaS Control Centre</h1>
                <p className="mt-0.5 text-sm text-white/80">
                  Platform-wide overview — tenants, subscriptions, revenue &amp; system health
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                <div className="grid w-full grid-cols-2 gap-2 text-center sm:w-auto sm:grid-cols-3 sm:gap-3">
                  {[
                    { label: "Total Tenants", value: summary?.total_tenants ?? "—" },
                    { label: "Active", value: summary?.active_tenants ?? "—" },
                    { label: "Inactive", value: summary?.inactive_tenants ?? "—" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur sm:px-4">
                      {headerLoading ? (
                        <Skeleton className="mx-auto h-6 w-10 bg-white/20" />
                      ) : (
                        <div className="text-lg font-bold text-white sm:text-xl">{item.value}</div>
                      )}
                      <div className="text-xs text-white/65">{item.label}</div>
                    </div>
                  ))}
                </div>

                <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end sm:gap-3">
                  {lastUpdated && (
                    <span className="text-xs text-white/65">
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

          {darajaHealth && (
            <div
              className={`rounded-xl border px-4 py-3 ${
                darajaHealth.ready
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-2">
                  {darajaHealth.ready ? (
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Daraja Payments Health</p>
                    <p className="text-xs text-slate-600">
                      Mode: <span className="font-medium uppercase">{darajaHealth.mode}</span> ·
                      Mock: <span className="font-medium">{darajaHealth.use_mock ? "ON" : "OFF"}</span> ·
                      Fallback:{" "}
                      <span className="font-medium">
                        {darajaHealth.sandbox_fallback_to_mock ? "ON" : "OFF"}
                      </span>{" "}
                      ·
                      Timeout: <span className="font-medium">{darajaHealth.timeout_sec}s</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Callback token: {darajaHealth.callback_token_protected ? "set" : "not set"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                      darajaHealth.ready
                        ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
                        : "bg-amber-100 text-amber-700 ring-amber-200"
                    }`}
                  >
                    {darajaHealth.ready ? "Ready" : "Config Needed"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void runDarajaConnectivityCheck()}
                    disabled={darajaConnectivityLoading}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={`h-3 w-3 ${darajaConnectivityLoading ? "animate-spin" : ""}`} />
                    {darajaConnectivityLoading ? "Checking..." : "Run Connectivity Test"}
                  </button>
                </div>
              </div>

              {!darajaHealth.ready && darajaHealth.missing_required.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-amber-800">Missing vars:</span>
                  {darajaHealth.missing_required.map((v) => (
                    <span
                      key={v}
                      className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              )}

              {darajaConnectivity && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      {darajaConnectivity.status === "healthy" ? (
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                      ) : darajaConnectivity.status === "misconfigured" ? (
                        <XCircle className="h-4 w-4 text-red-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                      )}
                      Connectivity Status: {darajaConnectivity.status.toUpperCase()}
                    </div>
                    <span className="text-xs text-slate-500">
                      Checked {timeAgo(darajaConnectivity.checked_at)}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-slate-600">{darajaConnectivity.recommendation}</p>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                      <p className="text-[11px] font-semibold uppercase text-slate-500">OAuth</p>
                      <p className="mt-1 text-xs text-slate-700">
                        {darajaConnectivity.oauth_check.attempted
                          ? darajaConnectivity.oauth_check.ok
                            ? `OK (${darajaConnectivity.oauth_check.latency_ms ?? 0} ms)`
                            : `FAILED${darajaConnectivity.oauth_check.error ? `: ${darajaConnectivity.oauth_check.error}` : ""}`
                          : "Not attempted"}
                      </p>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                      <p className="text-[11px] font-semibold uppercase text-slate-500">DNS</p>
                      <div className="mt-1 space-y-1">
                        {darajaConnectivity.dns_checks.map((item) => (
                          <p key={item.host} className="text-xs text-slate-700">
                            {item.host}: {item.ok ? `OK (${item.latency_ms ?? 0} ms)` : item.error || "Failed"}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Revenue KPIs ── */}
          <div>
            <DashboardSectionLabel>Revenue</DashboardSectionLabel>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardStatCard
                label="Monthly Recurring Revenue"
                value={metrics ? formatKes(metrics.revenue.mrr) : "—"}
                sub={
                  metrics
                    ? `${metrics.revenue.growth_percent > 0 ? "+" : ""}${metrics.revenue.growth_percent}% MoM`
                    : "Loading metrics…"
                }
                icon={TrendingUp}
                tone="accent"
                loading={kpiLoading}
              />
              <DashboardStatCard
                label="Annual Run Rate"
                value={metrics ? formatKes(metrics.revenue.arr) : "—"}
                sub="ARR based on current MRR"
                icon={CreditCard}
                tone="secondary"
                loading={kpiLoading}
              />
              <DashboardStatCard
                label="Active Subscriptions"
                value={metrics?.subscriptions.active ?? "—"}
                sub={metrics ? `${metrics.subscriptions.trialing} trialling` : ""}
                icon={CheckCircle}
                tone="sage"
                loading={kpiLoading}
              />
              <DashboardStatCard
                label="Past Due"
                value={metrics?.subscriptions.past_due ?? "—"}
                sub={metrics ? `${metrics.subscriptions.cancelled} cancelled` : ""}
                icon={AlertTriangle}
                tone={pastDueCount > 0 ? "danger" : "neutral"}
                loading={kpiLoading}
              />
            </div>
          </div>

          {/* ── Tenant KPIs ── */}
          <div>
            <DashboardSectionLabel>Tenants &amp; Users</DashboardSectionLabel>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardStatCard
                label="Total Tenants"
                value={summary?.total_tenants ?? "—"}
                sub={`${activeRate}% active`}
                icon={Building2}
                tone="secondary"
                loading={initialLoading && !summary}
              />
              <DashboardStatCard
                label="Active Tenants"
                value={summary?.active_tenants ?? "—"}
                sub={metrics ? `${metrics.tenants.new_this_month} new this month` : ""}
                icon={Activity}
                tone="sage"
                loading={initialLoading && !summary}
              />
              <DashboardStatCard
                label="Inactive Tenants"
                value={summary?.inactive_tenants ?? "—"}
                sub={metrics ? `${metrics.tenants.churned_this_month} churned this month` : ""}
                icon={XCircle}
                tone={summary && summary.inactive_tenants > 0 ? "warning" : "neutral"}
                loading={initialLoading && !summary}
              />
              <DashboardStatCard
                label="Total Users (All Tenants)"
                value={metrics?.tenants.total_users_across_tenants ?? "—"}
                sub="Across all tenants"
                icon={Users}
                tone="accent"
                loading={kpiLoading}
              />
            </div>
          </div>

          {/* ── System stats ── */}
          <div>
            <DashboardSectionLabel>Platform Data</DashboardSectionLabel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                {
                  label: "Enrollments",
                  value: metrics?.system.total_enrollments ?? "—",
                  color: "border-[#cedfe1] bg-[#e9f1f2] text-[#173f49] text-[#41636d]",
                },
                {
                  label: "Invoices",
                  value: metrics?.system.total_invoices ?? "—",
                  color: "border-[#d8e8df] bg-[#edf6f0] text-[#1f604d] text-[#4f7a68]",
                },
                {
                  label: "Audit Events",
                  value: metrics?.system.total_audit_events ?? "—",
                  color: "border-[#e1d5c2] bg-[#f7f3ec] text-[#21323a] text-[#6b7580]",
                },
                {
                  label: "Permissions",
                  value: metrics?.system.total_permissions ?? "—",
                  color: "border-[#ebd3c3] bg-[#f7e7dc] text-[#743116] text-[#9c5a37]",
                },
                {
                  label: "Roles",
                  value: metrics?.system.total_roles ?? "—",
                  color: "border-[#ead9bb] bg-[#f8efdf] text-[#7a4d12] text-[#9c6a28]",
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
            <div className="dashboard-surface rounded-[1.75rem]">
              <div className="border-b border-[#eadfce] px-6 py-4">
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
                          <div className="h-2 w-full overflow-hidden rounded-full bg-[#eee4d7]">
                            <div
                              className="h-full rounded-full bg-[#173f49] transition-all"
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
            <div className="dashboard-surface rounded-[1.75rem]">
              <div className="flex items-center justify-between border-b border-[#eadfce] px-6 py-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Recent Tenants</h2>
                    <p className="mt-0.5 text-xs text-slate-400">Latest onboarded institutions</p>
                  </div>
                </div>
                <a href="/saas/tenants" className="text-xs font-medium text-[#173f49] hover:underline">
                  View all →
                </a>
              </div>

              <div className="divide-y divide-[#efe4d2]">
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
                    <div key={t.id} className="flex items-center gap-3 px-6 py-3 hover:bg-[#faf5ee]">
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
                            <span className={dashboardBadgeClasses("secondary")}>
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

          {/* ── Recent payments ── */}
            <div className="dashboard-surface rounded-[1.75rem]">
              <div className="flex items-center justify-between border-b border-[#eadfce] px-6 py-4">
              <div className="flex items-center gap-2">
                <HandCoins className="h-4 w-4 text-slate-400" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Recent Tenant Payments</h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Latest subscription payments with term/year context
                  </p>
                </div>
              </div>
              <a href="/saas/payment-history" className="text-xs font-medium text-[#173f49] hover:underline">
                View all →
              </a>
            </div>

            <div className="divide-y divide-[#efe4d2]">
              {recentPayments.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <HandCoins className="h-8 w-8 text-slate-200" />
                  <p className="text-sm text-slate-400">{initialLoading ? "Loading…" : "No recent payments yet"}</p>
                  <p className="text-xs text-slate-300 max-w-xs">
                    Endpoint:{" "}
                    <code className="rounded bg-slate-100 px-1">GET /api/v1/admin/saas/payments/recent</code>
                  </p>
                </div>
              ) : (
                recentPayments.map((p) => (
                  <div key={p.id} className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">{p.tenant_name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          {p.billing_term_label || (p.billing_plan === "per_year" ? "Per Year" : "Per Term")}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                            p.status === "completed"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : p.status === "pending"
                              ? "bg-amber-50 text-amber-700 ring-amber-200"
                              : "bg-red-50 text-red-700 ring-red-200"
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        <span className="font-mono">{p.tenant_slug}</span>
                        <span className="ml-2">
                          {timeAgo(p.paid_at ?? p.created_at)} · {new Date(p.paid_at ?? p.created_at).toLocaleString("en-KE")}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-800">{formatKes(p.amount_kes)}</div>
                      <div className="text-xs text-slate-400">{p.mpesa_receipt || "No receipt yet"}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Module quick links ── */}
          <div>
            <DashboardSectionLabel>Admin Modules</DashboardSectionLabel>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DashboardModuleCard
                href="/saas/rollout"
                icon={Rocket}
                title="Rollout Desk"
                description="Review demo, enquiry, and school-visit requests coming from the public onboarding site."
                badge="Prospect intake"
                tone="accent"
                badgeTone="warning"
              />
              <DashboardModuleCard
                href="/saas/tenants"
                icon={Building2}
                title="Tenants"
                description="Onboard, configure, activate or suspend tenant institutions across the platform."
                badge={`${summary?.total_tenants ?? 0} total`}
                tone="secondary"
                badgeTone="secondary"
              />
              <DashboardModuleCard
                href="/saas/subscriptions"
                icon={CreditCard}
                title="Subscriptions"
                description="Manage billing plans, payment status, trial periods, and renewal schedules."
                badge={pastDueCount > 0 ? `${pastDueCount} past due` : "Up to date"}
                tone="sage"
                badgeTone={pastDueCount > 0 ? "danger" : "sage"}
              />
              <DashboardModuleCard
                href="/saas/payment-history"
                icon={HandCoins}
                title="Payment History"
                description="Review all tenant subscription payments with audit-friendly timestamps and term labels."
                badge={recentPayments.length > 0 ? `${recentPayments.length} recent` : "No recent"}
                tone="secondary"
                badgeTone={recentPayments.length > 0 ? "secondary" : "neutral"}
              />
              <DashboardModuleCard
                href="/saas/academic-calendar"
                icon={CalendarDays}
                title="Academic Calendar"
                description="Define national term windows and apply them to tenant schools for per-term billing consistency."
                badge="Term billing"
                tone="warning"
                badgeTone="warning"
              />
              <DashboardModuleCard
                href="/saas/rbac/permissions"
                icon={ShieldCheck}
                title="Permissions"
                description="Define system-wide permission codes available to all tenant roles and overrides."
                badge={metrics ? `${metrics.system.total_permissions} defined` : undefined}
                tone="accent"
                badgeTone="accent"
              />
              <DashboardModuleCard
                href="/saas/rbac/roles"
                icon={Layers}
                title="Roles"
                description="Create and manage global role templates that tenant directors can assign to users."
                badge={metrics ? `${metrics.system.total_roles} roles` : undefined}
                tone="warning"
                badgeTone="warning"
              />
              <DashboardModuleCard
                href="/saas/audit"
                icon={ClipboardList}
                title="Audit Logs"
                description="Platform-wide audit trail across all tenants, actions, and system events."
                badge={metrics ? `${metrics.system.total_audit_events} events` : undefined}
                tone="neutral"
                badgeTone="neutral"
              />
              <DashboardModuleCard
                href="/saas/users"
                icon={Users}
                title="Platform Users"
                description="View and manage all user accounts across every tenant on the platform."
                badge={metrics ? `${metrics.tenants.total_users_across_tenants} users` : undefined}
                tone="secondary"
                badgeTone="neutral"
              />
            </div>
          </div>
        </div>
      </AppShell>
    </RequireAuth>
  );
}
