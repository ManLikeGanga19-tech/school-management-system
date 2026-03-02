import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { decodeAccess } from "@/lib/auth/jwt";
import {
  hasDirectorRole,
  hasPrincipalRole,
  hasSecretaryRole,
} from "@/lib/auth/tenant-dashboard";

export default async function PrincipalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = (await cookies()).get("sms_access")?.value;
  if (!token) redirect("/login");

  const claims = decodeAccess(token);
  const roles = claims?.roles || [];
  const isPrincipal = hasPrincipalRole(roles);

  if (!isPrincipal) {
    if (hasDirectorRole(roles)) redirect("/tenant/director/dashboard");
    if (hasSecretaryRole(roles)) redirect("/tenant/secretary/dashboard");
    redirect("/dashboard");
  }

  return <>{children}</>;
}
