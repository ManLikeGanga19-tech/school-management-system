import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeAccess } from "@/lib/auth/jwt";
import { resolveTenantDashboard } from "@/lib/auth/tenant-dashboard";

export default async function DashboardLandingPage() {
  const c = await cookies();
  const tenantAccess = c.get("sms_access")?.value;
  const saasAccess = c.get("sms_saas_access")?.value;

  if (tenantAccess) {
    const claims = decodeAccess(tenantAccess);
    redirect(resolveTenantDashboard(claims?.roles));
  }

  if (saasAccess) {
    redirect("/saas/dashboard");
  }

  redirect("/login");
}
