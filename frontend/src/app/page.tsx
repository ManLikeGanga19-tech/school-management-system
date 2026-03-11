import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PublicSite } from "@/components/marketing/PublicSite";

export const metadata = {
  title: "ShuleHQ | School Operations Platform",
  description:
    "ShuleHQ is a multi-tenant school operations platform for academic workflows, finance, onboarding, and SaaS administration.",
};

export default async function Home() {
  const c = await cookies();
  const tenantAccess = c.get("sms_access")?.value;
  const saasAccess = c.get("sms_saas_access")?.value;

  if (tenantAccess) {
    redirect("/dashboard");
  }

  if (saasAccess) {
    redirect("/saas/dashboard");
  }

  return <PublicSite />;
}
