"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis } from "recharts";
import {
  Search,
  RefreshCw,
  ClipboardList,
  TrendingUp,
  XCircle,
  Filter,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { asArray } from "@/lib/utils/asArray";
// ─── Types ────────────────────────────────────────────────────────────────────

type AuditRow = {
  id: string;
  action: string;
  resource: string;
  created_at: string;
};

// ─── Chart config ─────────────────────────────────────────────────────────────

const chartConfig = {
  events: { label: "Events", color: "#3b82f6" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toHourBucket(iso: string) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "unknown";
  return `${dt.getUTCHours().toString().padStart(2, "0")}:00`;
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** Color-code action badges by verb */
function actionBadgeClass(action: string): string {
  const verb = action.split(".")[0]?.toLowerCase() ?? "";
  if (["create", "post", "add"].includes(verb))
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (["approve", "enroll", "complete", "activate"].includes(verb))
    return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  if (["reject", "delete", "remove", "deactivate"].includes(verb))
    return "bg-red-50 text-red-700 ring-1 ring-red-200";
  if (["update", "edit", "transfer", "patch"].includes(verb))
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (["submit", "review", "request"].includes(verb))
    return "bg-purple-50 text-purple-700 ring-1 ring-purple-200";
  return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({
  title,
  subtitle,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="dashboard-surface rounded-[1.6rem]">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-slate-400" />}
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${color}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs font-medium opacity-70">{label}</div>
    </div>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-12 text-center">
        <div className="flex flex-col items-center gap-1">
          <ClipboardList className="h-6 w-6 text-slate-200" />
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TenantAuditPage() {
  const [rows, setRows]         = useState<AuditRow[]>([]);
  const [action, setAction]     = useState("");
  const [resource, setResource] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const qs = new URLSearchParams({ limit: "100", offset: "0" });
    if (action.trim()) qs.set("action", action.trim());
    if (resource.trim()) qs.set("resource", resource.trim());

    try {
      const body = await api.get<any>(`/tenants/director/audit?${qs.toString()}`, { tenantRequired: true });
      setRows(Array.isArray(body) ? body : asArray(body?.logs));
      setLastUpdated(new Date());
      setError(null);
    } catch (err: any) {
      setError(typeof err?.message === "string" ? err.message : "Audit service unavailable.");
      setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  function handleApply() {
    void load();
  }

  function handleClear() {
    setAction("");
    setResource("");
    // load after state clears on next tick
    setTimeout(() => void load(), 0);
  }

  // Chart data
  const trendMap = rows.reduce((acc, row) => {
    const bucket = toHourBucket(row.created_at);
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const trend = Object.entries(trendMap)
    .map(([hour, events]) => ({ hour, events }))
    .sort((a, b) => (a.hour > b.hour ? 1 : -1));

  // Derived stats
  const uniqueActions   = new Set(rows.map((r) => r.action.split(".")[0])).size;
  const uniqueResources = new Set(rows.map((r) => r.resource)).size;
  const peakHour        = trend.reduce(
    (max, d) => (d.events > (max?.events ?? 0) ? d : max),
    trend[0]
  );
  const isFiltered = action.trim() || resource.trim();

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/director/audit">
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">Audit Monitoring</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Real-time tenant audit stream and operational traceability
              </p>
            </div>
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-blue-200">
                  Updated {timeAgo(lastUpdated.toISOString())}
                </span>
              )}
              <div className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                Live
              </div>
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 shrink-0 text-red-500" />
              {error}
            </div>
            <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* ── Stat strip ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatPill label="Total Events"      value={rows.length}       color="border-blue-100 bg-blue-50 text-blue-900" />
          <StatPill label="Unique Actions"    value={uniqueActions}     color="border-emerald-100 bg-emerald-50 text-emerald-900" />
          <StatPill label="Resources Touched" value={uniqueResources}   color="border-amber-100 bg-amber-50 text-amber-900" />
          <StatPill label="Peak Hour"         value={peakHour?.hour ?? "—"} color="border-purple-100 bg-purple-50 text-purple-900" />
        </div>

        {/* ── Filter panel ── */}
        <SectionCard
          title="Filter Events"
          subtitle="Narrow results by action verb or resource name"
          icon={Filter}
        >
          <div className="p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-medium text-slate-500">Action</label>
                <Input
                  placeholder="e.g. enrollment.approve"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApply()}
                  className="bg-slate-50"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-medium text-slate-500">Resource</label>
                <Input
                  placeholder="e.g. finance.invoice"
                  value={resource}
                  onChange={(e) => setResource(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApply()}
                  className="bg-slate-50"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleApply}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5" />
                      Apply Filter
                    </span>
                  )}
                </Button>
                {isFiltered && (
                  <Button variant="outline" onClick={handleClear}>
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {/* Active filter pills */}
            {isFiltered && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {action.trim() && (
                  <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
                    action: <strong>{action.trim()}</strong>
                    <button onClick={() => setAction("")} className="ml-1 opacity-60 hover:opacity-100">✕</button>
                  </span>
                )}
                {resource.trim() && (
                  <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
                    resource: <strong>{resource.trim()}</strong>
                    <button onClick={() => setResource("")} className="ml-1 opacity-60 hover:opacity-100">✕</button>
                  </span>
                )}
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                  {rows.length} result{rows.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Volume trend chart ── */}
        <SectionCard
          title="Event Volume by Hour (UTC)"
          subtitle="Distribution of audit events across the day"
          icon={TrendingUp}
          action={
            trend.length > 0 ? (
              <span className="text-xs text-slate-400">{trend.length} hour bucket{trend.length !== 1 ? "s" : ""}</span>
            ) : undefined
          }
        >
          <div className="p-6 pt-4">
            {trend.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <LineChart data={trend} accessibilityLayer>
                  <CartesianGrid vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="hour"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    type="monotone"
                    dataKey="events"
                    stroke="var(--color-events)"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, fill: "#3b82f6" }}
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <div className="flex h-[200px] items-center justify-center text-sm text-slate-400">
                No event data to display
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Audit log table ── */}
        <SectionCard
          title="Audit Log"
          subtitle={`Showing up to 30 of ${rows.length} event${rows.length !== 1 ? "s" : ""}`}
          icon={ClipboardList}
          action={
            <button
              onClick={() => void load(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="text-xs">Action</TableHead>
                <TableHead className="text-xs">Resource</TableHead>
                <TableHead className="text-xs">Timestamp</TableHead>
                <TableHead className="text-xs">When</TableHead>
                <TableHead className="text-xs">Event ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center">
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading audit logs…
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!loading && rows.slice(0, 30).map((r) => (
                <TableRow key={r.id} className="hover:bg-slate-50">
                  <TableCell className="py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-medium ${actionBadgeClass(r.action)}`}>
                      {r.action}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-slate-600">{r.resource}</TableCell>
                  <TableCell className="py-3 text-xs text-slate-400 whitespace-nowrap">
                    {formatTimestamp(r.created_at)}
                  </TableCell>
                  <TableCell className="py-3 text-xs text-slate-400 whitespace-nowrap">
                    {timeAgo(r.created_at)}
                  </TableCell>
                  <TableCell className="py-3 font-mono text-xs text-slate-300">
                    {r.id.slice(0, 8)}…
                  </TableCell>
                </TableRow>
              ))}

              {!loading && rows.length === 0 && (
                <EmptyRow
                  colSpan={5}
                  message={isFiltered ? "No events match your filter." : "No audit logs found."}
                />
              )}
            </TableBody>
          </Table>

          {rows.length > 30 && (
            <p className="border-t border-slate-100 py-3 text-center text-xs text-slate-400">
              Showing 30 of {rows.length} events — refine your filter to narrow results.
            </p>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
