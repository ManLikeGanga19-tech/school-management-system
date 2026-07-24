import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { PublicSite } from "@/components/marketing/PublicSite";
import type { PublicStats } from "@/components/marketing/TrustBar";
import { resolvePortalContext } from "@/lib/platform-host";

// Real, aggregate-only counts from the backend, fetched server-side so the
// marketing numbers are live and never fabricated. Fails soft to null — the
// TrustBar simply hides numbers rather than breaking the page.
async function getPublicStats(): Promise<PublicStats> {
  const base = process.env.BACKEND_BASE_URL || "http://nginx/api/v1";
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${base}/public/stats`, {
      signal: controller.signal,
      next: { revalidate: 300 },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      schools_active: Number(data.schools_active) || 0,
      students_total: Number(data.students_total) || 0,
    };
  } catch {
    return null;
  }
}

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

  const stats = await getPublicStats();

  return <PublicSite adminHost={adminHost} tenantBaseHost={publicHost} stats={stats} />;
}
