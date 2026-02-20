// src/app/saas/layout.tsx
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * SaaS Layout Guard (server-side)
 * - Only allows SaaS routes when sms_saas_access exists.
 * - Redirects to /saas/login otherwise.
 *
 * Middleware already enforces this, but this is an enterprise "belt + suspenders" guard.
 */
export default async function SaaSLayout({ children }: { children: ReactNode }) {
  const saasToken = (await cookies()).get("sms_saas_access")?.value;

  if (!saasToken) {
    redirect("/saas/login");
  }

  return <>{children}</>;
}