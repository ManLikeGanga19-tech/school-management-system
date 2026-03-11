import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { PublicSite } from "@/components/marketing/PublicSite";
import { resolvePortalContext } from "@/lib/platform-host";

export const metadata = {
  title: "ShuleHQ | School Operations Platform",
  description:
    "ShuleHQ is a multi-tenant school operations platform for academic workflows, finance, onboarding, and SaaS administration.",
};

export default async function Home() {
  const c = await cookies();
  const hdrs = await headers();
  const portal = resolvePortalContext(hdrs.get("x-forwarded-host") ?? hdrs.get("host"));
  const tenantAccess = c.get("sms_access")?.value;
  const saasAccess = c.get("sms_saas_access")?.value;
  const publicHost = portal.publicHost || "shulehq.co.ke";
  const adminHost = portal.adminHost || `admin.${publicHost}`;

  if (portal.kind === "admin") {
    redirect(saasAccess ? "/saas/dashboard" : "/saas/login");
  }

  if (portal.kind === "tenant") {
    redirect(tenantAccess ? "/dashboard" : "/login");
  }

  return <PublicSite adminHost={adminHost} tenantBaseHost={publicHost} />;
}
