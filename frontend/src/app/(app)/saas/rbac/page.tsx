"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SaaSRbacHubPage() {
  const nav = useMemo(
    () => [
      { href: "/saas/dashboard", label: "SaaS Summary" },
      { href: "/saas/tenants", label: "Tenants" },
      { href: "/saas/rbac", label: "RBAC" },
      { href: "/saas/audit", label: "Audit Logs" },
    ],
    []
  );

  return (
    <AppShell title="Super Admin" nav={nav} activeHref="/saas/rbac">
      <div>
        <h1 className="text-2xl font-semibold">RBAC</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage platform permissions and role catalogs (enterprise controls).
        </p>
      </div>

      <div className="grid gap-4 mt-6 sm:grid-cols-2">
        <Link href="/saas/rbac/permissions">
          <Card className="rounded-2xl hover:bg-muted/30 transition-colors">
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>
                Create & maintain permission codes used by access tokens and policies.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Search, create, edit, delete (cascade-safe).
            </CardContent>
          </Card>
        </Link>

        <Link href="/saas/rbac/roles">
          <Card className="rounded-2xl hover:bg-muted/30 transition-colors">
            <CardHeader>
              <CardTitle>Roles</CardTitle>
              <CardDescription>
                View global/tenant roles and inspect role permission sets.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Filter by scope, inspect role permissions, maintain role catalog.
            </CardContent>
          </Card>
        </Link>
      </div>
    </AppShell>
  );
}