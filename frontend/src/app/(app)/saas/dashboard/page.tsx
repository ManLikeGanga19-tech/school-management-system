"use client";

import RequireAuth from "@/components/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type SaaSSummary = {
  total_tenants: number;
  active_tenants: number;
  inactive_tenants: number;
};

export default function SaaSDashboardPage() {
  const nav = [
    { href: "/saas/dashboard", label: "SaaS Summary" },
    { href: "/saas/tenants", label: "Tenants" },
    { href: "/saas/rbac/permissions", label: "Permissions" },
    { href: "/saas/rbac/roles", label: "Roles" },
    { href: "/saas/audit", label: "Audit Logs" },
  ];

  const [data, setData] = useState<SaaSSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<SaaSSummary>("/api/v1/admin/saas/summary", {
        method: "GET",
        tenantRequired: false,
      });
      setData(res);
    } catch (e: any) {
      setError(e?.message || "Failed to load SaaS summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <RequireAuth mode="saas">
      <AppShell title="Super Admin" nav={nav}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold">SaaS Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Platform overview for SUPER_ADMIN.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Couldn’t load summary</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Tenants
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-3xl font-semibold">{data?.total_tenants ?? 0}</div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active Tenants
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-3xl font-semibold">{data?.active_tenants ?? 0}</div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Inactive Tenants
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-3xl font-semibold">{data?.inactive_tenants ?? 0}</div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </AppShell>
    </RequireAuth>
  );
}
