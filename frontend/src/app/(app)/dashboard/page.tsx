import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeAccess } from "@/lib/auth/jwt";

function resolveTenantDashboard(roles: string[] | undefined) {
  const codes = new Set((roles || []).map((r) => r.toUpperCase()));

  if (codes.has("DIRECTOR")) return "/tenant/director/dashboard";
  if (codes.has("SECRETARY")) return "/tenant/secretary/dashboard";

  return "/tenant/dashboard";
}

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

  redirect("/choose-tenant");
}