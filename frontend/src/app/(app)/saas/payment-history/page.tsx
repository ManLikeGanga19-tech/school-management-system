"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { DashboardStatCard } from "@/components/dashboard/dashboard-primitives";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { toast } from "@/components/ui/sonner";
import { Building2, CalendarDays, HandCoins, Receipt, RefreshCw, WalletCards } from "lucide-react";

type SaaSPaymentRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  amount_kes: number;
  status: "pending" | "completed" | "failed" | "cancelled";
  phone_number?: string | null;
  mpesa_receipt?: string | null;
  billing_plan: "per_term" | "per_year";
  billing_term_label?: string | null;
  paid_at?: string | null;
  created_at: string;
};

type SaaSPaymentHistoryResponse = {
  total: number;
  items: SaaSPaymentRow[];
};

type TenantOption = {
  id: string;
  name: string;
  slug: string;
};

const PAGE_SIZES = [20, 30, 50, 100] as const;
const STATUS_OPTIONS = ["all", "completed", "pending", "failed", "cancelled"] as const;

function formatKes(v: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE");
}

export default function SaaSPaymentHistoryPage() {
  const [rows, setRows] = useState<SaaSPaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [tenantId, setTenantId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
    [total, pageSize]
  );
  const completedCount = useMemo(
    () => rows.filter((row) => row.status === "completed").length,
    [rows]
  );
  const pendingCount = useMemo(
    () => rows.filter((row) => row.status === "pending").length,
    [rows]
  );
  const totalAmount = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.amount_kes || 0), 0),
    [rows]
  );

  const loadTenants = useCallback(async () => {
    try {
      const data = await apiFetch<TenantOption[]>("/admin/tenants", {
        method: "GET",
        tenantRequired: false,
      });
      setTenants(data ?? []);
    } catch {
      setTenants([]);
    }
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const offset = (page - 1) * pageSize;
        const params = new URLSearchParams();
        params.set("limit", String(pageSize));
        params.set("offset", String(offset));
        if (q.trim()) params.set("q", q.trim());
        if (status !== "all") params.set("status", status);
        if (tenantId !== "all") params.set("tenant_id", tenantId);
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);

        const data = await apiFetch<SaaSPaymentHistoryResponse>(
          `/admin/saas/payments/history?${params.toString()}`,
          { method: "GET", tenantRequired: false }
        );
        setRows(data.items ?? []);
        setTotal(Number(data.total ?? 0));
      } catch (e: any) {
        const msg = e?.message ?? "Failed to load payment history";
        setError(msg);
        toast.error(msg);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, pageSize, q, status, tenantId, dateFrom, dateTo]
  );

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/payment-history">
      <div className="space-y-5">
        <SaasPageHeader
          title="Payment History"
          description="Cross-tenant billing ledger for completed, pending, and failed subscription collections."
          badges={[
            { label: "Super Admin", icon: WalletCards },
            { label: "SaaS Billing", icon: HandCoins },
          ]}
          metrics={[
            { label: "Visible Rows", value: rows.length },
            { label: "Completed", value: completedCount },
            { label: "Pending", value: pendingCount, tone: pendingCount > 0 ? "warning" : "default" },
            { label: "Loaded Value", value: formatKes(totalAmount) },
          ]}
          actions={
            <Button
              variant="outline"
              className="gap-1.5 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void load(true)}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardStatCard label="Processed Payments" value={completedCount} sub="Confirmed settlements in view" icon={Receipt} tone="accent" />
          <DashboardStatCard label="Active Queues" value={pendingCount} sub="Payments still waiting for completion" icon={CalendarDays} tone={pendingCount > 0 ? "warning" : "neutral"} />
          <DashboardStatCard label="Tenants in View" value={new Set(rows.map((row) => row.tenant_id)).size} sub="Distinct schools in this slice" icon={Building2} tone="secondary" />
          <DashboardStatCard label="Gross Loaded Value" value={formatKes(totalAmount)} sub="Total amount across loaded rows" icon={HandCoins} tone="sage" />
        </div>

        <SaasSurface className="p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <Label className="text-xs text-slate-500">Search</Label>
              <Input
                placeholder="Tenant, receipt, checkout id, phone…"
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
              />
            </div>

            <div>
              <Label className="text-xs text-slate-500">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => {
                  setPage(1);
                  setStatus(v);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "All statuses" : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-slate-500">Tenant</Label>
              <Select
                value={tenantId}
                onValueChange={(v) => {
                  setPage(1);
                  setTenantId(v);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tenants</SelectItem>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-slate-500">Date From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setPage(1);
                  setDateFrom(e.target.value);
                }}
              />
            </div>

            <div>
              <Label className="text-xs text-slate-500">Date To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setPage(1);
                  setDateTo(e.target.value);
                }}
              />
            </div>
          </div>
        </SaasSurface>

        <SaasSurface className="overflow-hidden">
          {error && (
            <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="text-xs whitespace-nowrap">Date/Time</TableHead>
                  <TableHead className="text-xs">Tenant</TableHead>
                  <TableHead className="hidden md:table-cell text-xs">Term</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="hidden sm:table-cell text-xs">Receipt</TableHead>
                  <TableHead className="hidden sm:table-cell text-xs">Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-9 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">
                      No payments found for the selected filters.
                    </TableCell>
                  </TableRow>
                )}

                {!loading && rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-slate-500">
                      {formatDateTime(r.paid_at ?? r.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium text-slate-900">{r.tenant_name}</div>
                      <div className="text-xs text-slate-400">{r.tenant_slug}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs">
                      {r.billing_term_label || (r.billing_plan === "per_year" ? "Per Year" : "Per Term")}
                    </TableCell>
                    <TableCell className="text-sm font-semibold text-slate-800">
                      {formatKes(r.amount_kes)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                          r.status === "completed"
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : r.status === "pending"
                            ? "bg-amber-50 text-amber-700 ring-amber-200"
                            : "bg-red-50 text-red-700 ring-red-200"
                        }`}
                      >
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-slate-500">{r.mpesa_receipt || "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-slate-500">{r.phone_number || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-slate-500">
              Showing {rows.length} of {total} payment records
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPage(1);
                  setPageSize(Number(v));
                }}
              >
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((sz) => (
                    <SelectItem key={sz} value={String(sz)}>{sz} / page</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <div className="min-w-[90px] text-center text-xs text-slate-500">
                Page {page} / {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </SaasSurface>
      </div>
    </AppShell>
  );
}
