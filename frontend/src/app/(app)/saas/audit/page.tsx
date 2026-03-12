"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { DashboardStatCard } from "@/components/dashboard/dashboard-primitives";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AuditLogRow } from "@/lib/admin/audit";
import { getAuditLog, listAuditLogs } from "@/lib/admin/audit";
import { listTenants } from "@/lib/admin/tenants";
import {
  Activity,
  ClipboardList,
  ShieldCheck,
  Search,
  RefreshCw,
  Filter,
  X,
  Eye,
  ChevronLeft,
  ChevronRight,
  XCircle,
  TrendingUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantOption = { id: string; name: string; slug: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toIsoStart(d: string) {
  return new Date(`${d}T00:00:00.000Z`).toISOString();
}
function toIsoEnd(d: string) {
  return new Date(`${d}T23:59:59.999Z`).toISOString();
}
function pretty(obj: any) {
  try { return JSON.stringify(obj ?? {}, null, 2); }
  catch { return String(obj); }
}

function timeAgo(iso?: string) {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatTimestamp(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function actionBadgeClass(action: string) {
  const verb = action.split(".")[0]?.toLowerCase() ?? "";
  if (["create", "post", "add"].includes(verb))
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (["approve", "enroll", "complete", "activate", "restore"].includes(verb))
    return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  if (["reject", "delete", "remove", "deactivate", "suspend"].includes(verb))
    return "bg-red-50 text-red-700 ring-1 ring-red-200";
  if (["update", "edit", "transfer", "patch"].includes(verb))
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (["submit", "review", "request", "login", "logout"].includes(verb))
    return "bg-purple-50 text-purple-700 ring-1 ring-purple-200";
  return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaaSAuditPage() {
  const [rows, setRows]   = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr]     = useState<string | null>(null);

  // Tenant filter options
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [tenantId, setTenantId]           = useState<string>("all");

  // Filters
  const [q, setQ]                     = useState("");
  const [action, setAction]           = useState("");
  const [resource, setResource]       = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [requestId, setRequestId]     = useState("");
  const [fromDate, setFromDate]       = useState("");
  const [toDate, setToDate]           = useState("");

  // Pagination
  const [limit, setLimit]   = useState(50);
  const [offset, setOffset] = useState(0);

  // Detail dialog
  const [detailOpen, setDetailOpen]       = useState(false);
  const [selected, setSelected]           = useState<AuditLogRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────

  async function loadTenants() {
    try {
      const t = await listTenants({});
      setTenantOptions(
        (t ?? []).map((x: any) => ({
          id:   String(x.id),
          name: String(x.name ?? x.slug ?? "Tenant"),
          slug: String(x.slug ?? ""),
        }))
      );
    } catch {
      setTenantOptions([]);
    }
  }

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setErr(null);

    const params: Record<string, any> = { limit, offset };
    if (tenantId !== "all")    params.tenant_id      = tenantId;
    if (q.trim())              params.q              = q.trim();
    if (action.trim())         params.action         = action.trim();
    if (resource.trim())       params.resource       = resource.trim();
    if (actorUserId.trim())    params.actor_user_id  = actorUserId.trim();
    if (requestId.trim())      params.request_id     = requestId.trim();
    if (fromDate)              params.from_dt        = toIsoStart(fromDate);
    if (toDate)                params.to_dt          = toIsoEnd(toDate);

    try {
      const res = await listAuditLogs(params);
      setRows(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't load audit logs");
      setRows([]);
      setTotal(0);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { void loadTenants(); }, []);
  useEffect(() => { void load(); }, [tenantId, limit, offset]);

  function applyFilters() {
    setOffset(0);
    void load();
  }

  function clearFilters() {
    setTenantId("all");
    setQ(""); setAction(""); setResource("");
    setActorUserId(""); setRequestId("");
    setFromDate(""); setToDate("");
    setOffset(0);
    toast.success("Filters cleared");
  }

  // ── Detail dialog ─────────────────────────────────────────────────────────

  async function openDetails(row: AuditLogRow) {
    setSelected(row);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const fresh = await getAuditLog(row.id);
      setSelected(fresh);
    } catch {
      // fall back to row we already have
    } finally {
      setDetailLoading(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const pageFrom = total === 0 ? 0 : offset + 1;
  const pageTo   = Math.min(offset + limit, total);
  const hasPrev  = offset > 0;
  const hasNext  = offset + limit < total;

  const activeFilters = [
    tenantId !== "all" && `tenant: ${tenantOptions.find((t) => t.id === tenantId)?.slug ?? tenantId.slice(0, 8)}`,
    q.trim()           && `search: "${q.trim()}"`,
    action.trim()      && `action: ${action.trim()}`,
    resource.trim()    && `resource: ${resource.trim()}`,
    actorUserId.trim() && `actor: ${actorUserId.trim().slice(0, 8)}…`,
    requestId.trim()   && `req: ${requestId.trim().slice(0, 8)}…`,
    fromDate           && `from: ${fromDate}`,
    toDate             && `to: ${toDate}`,
  ].filter(Boolean) as string[];

  const uniqueActions   = new Set(rows.map((r) => r.action.split(".")[0])).size;
  const uniqueTenants   = new Set(rows.map((r) => r.tenant_id)).size;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/audit">

      {/* ── Detail dialog ── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit Event Detail</DialogTitle>
            <DialogDescription>
              {selected ? (
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium ${actionBadgeClass(selected.action)}`}>
                    {selected.action}
                  </span>
                  <code className="text-xs text-slate-400">{selected.id}</code>
                </span>
              ) : "—"}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : selected && (
            <div className="space-y-4">
              {/* Key fields grid */}
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Action",    value: selected.action    },
                  { label: "Resource",  value: selected.resource  },
                  { label: "Tenant ID", value: selected.tenant_id },
                  { label: "Actor ID",  value: selected.actor_user_id || "—" },
                  { label: "Timestamp", value: formatTimestamp(selected.created_at) },
                  { label: "Request ID", value: (selected.meta as any)?.request_id ?? "—" },
                ].map((field) => (
                  <div key={field.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <div className="mb-1 text-xs font-medium text-slate-400">{field.label}</div>
                    <code className="text-xs text-slate-700 break-all">{String(field.value)}</code>
                  </div>
                ))}
              </div>

              {/* Meta */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Meta</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                  {pretty(selected.meta)}
                </pre>
              </div>

              {/* Payload */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Payload</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                  {pretty((selected as any).payload)}
                </pre>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Page body ── */}
      <div className="space-y-5">

        {/* Header */}
        <SaasPageHeader
          title="Audit Logs"
          description="Platform-wide event stream for tenant actions, RBAC changes, billing activity, and operational traces."
          badges={[
            { label: "Super Admin", icon: ShieldCheck },
            { label: "Cross-Tenant", icon: ClipboardList },
            { label: "Live Feed", icon: Activity },
          ]}
          metrics={[
            { label: "Total", value: total },
            { label: "Loaded", value: rows.length },
            { label: "Actions", value: uniqueActions },
            { label: "Tenants", value: uniqueTenants },
          ]}
        />

        {/* Error */}
        {err && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2"><XCircle className="h-4 w-4 shrink-0 text-red-500" />{err}</div>
            <button onClick={() => setErr(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Stat pills */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DashboardStatCard label="Total Events" value={total} sub="All rows matching current filters" icon={ClipboardList} tone="accent" />
          <DashboardStatCard label="Loaded This Page" value={rows.length} sub={`Offsets ${offset + 1}-${Math.min(offset + limit, total || rows.length)}`} icon={Eye} tone="neutral" />
          <DashboardStatCard label="Unique Actions" value={uniqueActions} sub="Distinct event verbs in view" icon={TrendingUp} tone="sage" />
          <DashboardStatCard label="Tenants In View" value={uniqueTenants} sub="Institutions represented in current slice" icon={Filter} tone="secondary" />
        </div>

        {/* Filter panel */}
        <SaasSurface>
          <div className="border-b border-slate-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Narrow results by tenant, action, resource, actor, or date range
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Tenant */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">Tenant</Label>
                <Select value={tenantId} onValueChange={setTenantId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All tenants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tenants</SelectItem>
                    {tenantOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} {t.slug ? `(${t.slug})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Search */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">Search</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="action / resource / request_id…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>

              {/* Action */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">Action</Label>
                <Input
                  placeholder="e.g. enrollment.create"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="h-8 text-xs"
                />
              </div>

              {/* Resource */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">Resource</Label>
                <Input
                  placeholder="e.g. finance.invoice"
                  value={resource}
                  onChange={(e) => setResource(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="h-8 text-xs"
                />
              </div>

              {/* Actor */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">Actor User ID</Label>
                <Input
                  placeholder="UUID"
                  value={actorUserId}
                  onChange={(e) => setActorUserId(e.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>

              {/* Request ID */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">Request ID</Label>
                <Input
                  placeholder="X-Request-ID"
                  value={requestId}
                  onChange={(e) => setRequestId(e.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>

              {/* Date range */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">From Date</Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">To Date</Label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              {/* Page size */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">Page Size</Label>
                <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[25, 50, 100, 200].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} per page</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Actions row */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-8 bg-blue-600 text-xs hover:bg-blue-700"
                onClick={applyFilters}
                disabled={loading}
              >
                <Search className="mr-1.5 h-3 w-3" />
                Apply Filters
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void load(true)}
                disabled={loading}
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </Button>
              {activeFilters.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-slate-500"
                  onClick={clearFilters}
                >
                  <X className="h-3 w-3" />
                  Clear All
                </Button>
              )}
            </div>

            {/* Active filter pills */}
            {activeFilters.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {activeFilters.map((f) => (
                  <span key={f} className="inline-flex items-center gap-1 rounded-full bg-[#e9f1f2] px-2.5 py-1 text-xs font-medium text-[#173f49] ring-1 ring-[#c9dadd]">
                    {f}
                  </span>
                ))}
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                  {total} result{total !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>
        </SaasSurface>

        {/* Results table */}
        <SaasSurface className="overflow-hidden">

          {/* Table toolbar */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Results</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Showing {pageFrom}–{pageTo} of {total} event{total !== 1 ? "s" : ""}
                </p>
              </div>
            </div>

            {/* Pagination controls */}
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
              <span className="text-xs text-slate-400">
                Page {Math.floor(offset / limit) + 1} of {Math.max(1, Math.ceil(total / limit))}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={loading || !hasPrev}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={loading || !hasNext}
                onClick={() => setOffset(offset + limit)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs">Resource</TableHead>
                  <TableHead className="text-xs">Tenant</TableHead>
                  <TableHead className="text-xs">Actor</TableHead>
                  <TableHead className="text-xs">Timestamp</TableHead>
                  <TableHead className="text-xs">When</TableHead>
                  <TableHead className="w-12 text-xs" />
                </TableRow>
              </TableHeader>
              <TableBody>

                {loading && (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7} className="py-3 px-5">
                        <Skeleton className="h-8 w-full rounded-lg" />
                      </TableCell>
                    </TableRow>
                  ))
                )}

                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <ClipboardList className="h-7 w-7 text-slate-200" />
                        <p className="text-sm text-slate-400">
                          {activeFilters.length > 0
                            ? "No events match your filters."
                            : "No audit logs found."}
                        </p>
                        {activeFilters.length > 0 && (
                          <button
                            onClick={clearFilters}
                            className="mt-1 text-xs text-blue-500 hover:underline"
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50">

                    {/* Action badge */}
                    <TableCell className="py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-medium ${actionBadgeClass(r.action)}`}>
                        {r.action}
                      </span>
                    </TableCell>

                    {/* Resource */}
                    <TableCell className="py-3 text-xs text-slate-600">
                      {r.resource}
                    </TableCell>

                    {/* Tenant */}
                    <TableCell className="py-3">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <code className="cursor-default rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-200">
                              {tenantOptions.find((t) => t.id === r.tenant_id)?.slug
                                ?? r.tenant_id.slice(0, 8) + "…"}
                            </code>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <span className="font-mono text-xs">{r.tenant_id}</span>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>

                    {/* Actor */}
                    <TableCell className="py-3">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <code className="cursor-default font-mono text-xs text-slate-400 hover:text-slate-700">
                              {r.actor_user_id
                                ? r.actor_user_id.slice(0, 8) + "…"
                                : "system"}
                            </code>
                          </TooltipTrigger>
                          {r.actor_user_id && (
                            <TooltipContent side="top">
                              <span className="font-mono text-xs">{r.actor_user_id}</span>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>

                    {/* Timestamp */}
                    <TableCell className="py-3 text-xs text-slate-400 whitespace-nowrap">
                      {formatTimestamp(r.created_at)}
                    </TableCell>

                    {/* Relative time */}
                    <TableCell className="py-3 text-xs text-slate-400 whitespace-nowrap">
                      {timeAgo(r.created_at)}
                    </TableCell>

                    {/* View button */}
                    <TableCell className="py-3 pr-4">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => void openDetails(r)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="text-xs">View full event</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Bottom pagination */}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-6 py-3">
              <span className="text-xs text-slate-400">
                {pageFrom}–{pageTo} of {total} events
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  disabled={loading || !hasPrev}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  disabled={loading || !hasNext}
                  onClick={() => setOffset(offset + limit)}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </SaasSurface>
      </div>
    </AppShell>
  );
}
