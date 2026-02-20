import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeAccess } from "@/lib/auth/jwt";

export default async function SecretaryLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = (await cookies()).get("sms_access")?.value;
  if (!token) redirect("/login");

  const claims = decodeAccess(token);
  const roles = new Set((claims?.roles || []).map((r) => r.toUpperCase()));

  if (!roles.has("SECRETARY")) {
    if (roles.has("DIRECTOR")) redirect("/tenant/director/dashboard");
    redirect("/dashboard");
  }

  return <>{children}</>;
}
