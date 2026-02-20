"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
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

import type { AuditLogRow } from "@/lib/admin/audit";
import { getAuditLog, listAuditLogs } from "@/lib/admin/audit";
import { listTenants } from "@/lib/admin/tenants"; // assumes you already have this

type TenantOption = { id: string; name: string; slug: string };

function toIsoStart(dateStr: string) {
  // dateStr = "YYYY-MM-DD"
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

function toIsoEnd(dateStr: string) {
  return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
}

function pretty(obj: any) {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return String(obj);
  }
}

export default function SaaSAuditPage() {
  const nav = useMemo(
    () => [
      { href: "/saas/dashboard", label: "SaaS Summary" },
      { href: "/saas/tenants", label: "Tenants" },
      { href: "/saas/rbac", label: "RBAC" },
      { href: "/saas/audit", label: "Audit Logs" },
    ],
    []
  );

  // data
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // tenants for filter
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [tenantId, setTenantId] = useState<string>("all");

  // filters
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [fromDate, setFromDate] = useState(""); // YYYY-MM-DD
  const [toDate, setToDate] = useState("");     // YYYY-MM-DD

  // paging
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  // details dialog
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AuditLogRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function loadTenants() {
    try {
      const t = await listTenants({}); // adjust if your function takes params
      const opts = (t || []).map((x: any) => ({
        id: String(x.id),
        name: String(x.name || x.slug || "Tenant"),
        slug: String(x.slug || ""),
      }));
      setTenantOptions(opts);
    } catch {
      // tenants filter is optional; don’t block page
      setTenantOptions([]);
    }
  }

  async function load() {
    setLoading(true);
    setErr(null);

    const params: any = {
      limit,
      offset,
    };

    if (tenantId !== "all") params.tenant_id = tenantId;

    const qv = q.trim();
    if (qv) params.q = qv;

    const av = action.trim();
    if (av) params.action = av;

    const rv = resource.trim();
    if (rv) params.resource = rv;

    const uv = actorUserId.trim();
    if (uv) params.actor_user_id = uv;

    const rid = requestId.trim();
    if (rid) params.request_id = rid;

    if (fromDate) params.from_dt = toIsoStart(fromDate);
    if (toDate) params.to_dt = toIsoEnd(toDate);

    try {
      const res = await listAuditLogs(params);
      setRows(res.items || []);
      setTotal(res.total || 0);
    } catch (e: any) {
      setErr(e?.message || "Couldn’t load audit logs");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, limit, offset]);

  // when filters change, reset paging (enterprise UX)
  useEffect(() => {
    setOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, action, resource, actorUserId, requestId, fromDate, toDate, tenantId]);

  async function onApplyFilters() {
    setOffset(0);
    await load();
  }

  function onClear() {
    setTenantId("all");
    setQ("");
    setAction("");
    setResource("");
    setActorUserId("");
    setRequestId("");
    setFromDate("");
    setToDate("");
    setOffset(0);
    toast.success("Filters cleared");
  }

  async function openDetails(row: AuditLogRow) {
    setSelected(row);
    setOpen(true);
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

  const pageFrom = total === 0 ? 0 : offset + 1;
  const pageTo = Math.min(offset + limit, total);

  return (
    <AppShell title="Super Admin" nav={nav} activeHref="/saas/audit">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Audit Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-tenant audit feed (SUPER_ADMIN). Filter by tenant, action, resource, actor, or request id.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={onApplyFilters} disabled={loading}>
            Apply filters
          </Button>
          <Button variant="outline" onClick={onClear} disabled={loading}>
            Clear
          </Button>
        </div>
      </div>

      <Card className="mt-6 rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Tenant</div>
            <Select value={tenantId} onValueChange={(v: any) => setTenantId(v)}>
              <SelectTrigger>
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

          <div className="space-y-1">
            <div className="text-sm font-medium">Search</div>
            <Input
              placeholder="Search action/resource/request_id…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Action</div>
            <Input
              placeholder="e.g. enrollment.create"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Resource</div>
            <Input
              placeholder="e.g. finance.invoice"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Actor user id</div>
            <Input
              placeholder="UUID"
              value={actorUserId}
              onChange={(e) => setActorUserId(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Request id</div>
            <Input
              placeholder="X-Request-ID"
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">From</div>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">To</div>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Page size</div>
            <Select value={String(limit)} onValueChange={(v: any) => setLimit(Number(v))}>
              <SelectTrigger>
                <SelectValue placeholder="Limit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Results</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {err && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {err}
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>
              Showing <span className="text-foreground font-medium">{pageFrom}</span>–{" "}
              <span className="text-foreground font-medium">{pageTo}</span> of{" "}
              <span className="text-foreground font-medium">{total}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={loading || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                disabled={loading || offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
              >
                Next
              </Button>
            </div>
          </div>

          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="text-sm text-muted-foreground">No audit logs match your filters.</div>
          )}

          {!loading &&
            rows.map((r) => (
              <div key={r.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="rounded-full">audit</Badge>
                      <code className="text-sm font-medium">{r.action}</code>
                      <Badge variant="secondary" className="rounded-full">
                        {r.resource}
                      </Badge>
                      <Badge variant="outline" className="rounded-full">
                        tenant: {r.tenant_id.slice(0, 8)}…
                      </Badge>
                    </div>

                    <div className="text-xs text-muted-foreground mt-2">
                      created_at: <code>{r.created_at}</code>
                    </div>

                    {r.meta?.request_id && (
                      <div className="text-xs text-muted-foreground mt-1">
                        request_id: <code>{String(r.meta.request_id)}</code>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 sm:justify-end">
                    <Button variant="outline" onClick={() => openDetails(r)}>
                      View
                    </Button>
                  </div>
                </div>

                <Separator className="my-3" />

                <div className="text-xs text-muted-foreground">
                  ID: <code>{r.id}</code>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit log</DialogTitle>
            <DialogDescription>
              {selected ? (
                <>
                  <span className="text-foreground font-medium">{selected.action}</span>{" "}
                  <span className="text-muted-foreground">·</span>{" "}
                  <code className="text-foreground">{selected.id}</code>
                </>
              ) : (
                "—"
              )}
            </DialogDescription>
          </DialogHeader>

          {detailLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {!detailLoading && selected && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border p-3">
                  <div className="text-xs text-muted-foreground">Tenant</div>
                  <div className="text-sm"><code>{selected.tenant_id}</code></div>
                </div>
                <div className="rounded-xl border p-3">
                  <div className="text-xs text-muted-foreground">Actor user id</div>
                  <div className="text-sm"><code>{selected.actor_user_id || "—"}</code></div>
                </div>
              </div>

              <div className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground mb-2">Meta</div>
                <pre className="text-xs overflow-auto whitespace-pre-wrap">{pretty(selected.meta)}</pre>
              </div>

              <div className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground mb-2">Payload</div>
                <pre className="text-xs overflow-auto whitespace-pre-wrap">{pretty(selected.payload)}</pre>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}