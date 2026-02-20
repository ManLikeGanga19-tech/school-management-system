"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  primary_domain: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

function statusBadge(active: boolean) {
  return active ? (
    <Badge className="rounded-full">Active</Badge>
  ) : (
    <Badge variant="secondary" className="rounded-full">
      Inactive
    </Badge>
  );
}

export default function SaaSTenantsPage() {
  const nav = useMemo(
    () => [
      { href: "/saas/dashboard", label: "SaaS Summary" },
      { href: "/saas/tenants", label: "Tenants" },
      { href: "/saas/rbac", label: "RBAC" },
      { href: "/saas/audit", label: "Audit Logs" },
    ],
    []
  );

  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status === "active") params.set("is_active", "true");
      if (status === "inactive") params.set("is_active", "false");

      const data = await apiFetch<TenantRow[]>(
        `/api/v1/admin/tenants?${params.toString()}`,
        { method: "GET", tenantRequired: false }
      );

      setRows(data || []);
    } catch (e: any) {
      setErr(e?.message || "Couldn’t load tenants");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function suspend(id: string) {
    try {
      await apiFetch(`/api/v1/admin/tenants/${id}/suspend`, {
        method: "POST",
        tenantRequired: false,
      });
      toast.success("Tenant suspended");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to suspend tenant");
    }
  }

  async function restore(id: string) {
    try {
      await apiFetch(`/api/v1/admin/tenants/${id}/restore`, {
        method: "POST",
        tenantRequired: false,
      });
      toast.success("Tenant restored");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to restore tenant");
    }
  }

  return (
    <AppShell title="Super Admin" nav={nav} activeHref="/saas/tenants">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage schools on the platform (suspend/restore).
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <Card className="mt-6 rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Search & Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder="Search by slug, name, or domain…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="sm:max-w-md"
          />

          <Select value={status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger className="sm:w-48">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={load} disabled={loading}>
            Apply
          </Button>
        </CardContent>
      </Card>

      <div className="mt-6">
        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {err}
          </div>
        )}

        <Card className="rounded-2xl mt-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tenant List</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {loading && (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {!loading && rows.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No tenants found for the current filters.
              </div>
            )}

            {!loading &&
              rows.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate">{t.name}</div>
                      {statusBadge(t.is_active)}
                    </div>

                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <div>
                        <span className="font-medium text-foreground/80">Slug:</span>{" "}
                        <code className="text-foreground">{t.slug}</code>
                      </div>
                      <div className="truncate">
                        <span className="font-medium text-foreground/80">Domain:</span>{" "}
                        {t.primary_domain || <span className="text-muted-foreground">—</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 sm:justify-end">
                    {t.is_active ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive">Suspend</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Suspend tenant?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This tenant will not be able to access the system until restored.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => suspend(t.id)}>
                              Suspend
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button>Restore</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Restore tenant?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This tenant will regain access immediately.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => restore(t.id)}>
                              Restore
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}