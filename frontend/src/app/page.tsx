import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

  redirect("/choose-tenant");
}