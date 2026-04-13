import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeAccess } from "@/lib/auth/jwt";

export default async function ParentPortalLayout({ children }: { children: ReactNode }) {
  const token = (await cookies()).get("sms_access")?.value;
  if (!token) redirect("/login");

  const claims = decodeAccess(token);
  const roles = new Set((claims?.roles || []).map((r: string) => r.toUpperCase()));

  if (!roles.has("PARENT")) {
    // Redirect staff to their own dashboard
    if (roles.has("DIRECTOR")) redirect("/tenant/director/dashboard");
    if (roles.has("SECRETARY")) redirect("/tenant/secretary/dashboard");
    redirect("/dashboard");
  }

  return <>{children}</>;
}
