import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";

export default async function TenantDashboardPage() {
  return (
    <AppShell title="School Admin" nav={directorNav} activeHref="/tenant/director/dashboard">
      <h1 className="text-2xl font-semibold">Tenant Dashboard</h1>
      <p className="text-sm text-muted-foreground mt-2">
        Next: wire this to <code>/api/v1/admin/summary</code>
      </p>
    </AppShell>
  );
}
