import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { resolvePortalContext } from "@/lib/platform-host";

export default async function LoginPage() {
  const c = await cookies();
  const hdrs = await headers();
  const portal = resolvePortalContext(hdrs.get("x-forwarded-host") ?? hdrs.get("host"));
  const tenantSlug = portal.tenantSlug || c.get("sms_tenant_slug")?.value || "";

  if (portal.kind === "admin") {
    redirect("/saas/login");
  }

  if (portal.kind !== "tenant") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#efe3c8_0%,#f7f2e8_34%,#fcfbf7_100%)] p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-8 rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur lg:grid-cols-[minmax(18rem,0.9fr)_minmax(20rem,1.1fr)] lg:p-8">
          <div className="space-y-4 rounded-[1.5rem] bg-slate-950 p-6 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">School workspace</p>
            <h1 className="text-3xl font-semibold tracking-tight">{tenantSlug}</h1>
            <p className="text-sm leading-6 text-slate-300">
              This sign-in screen is scoped to your school subdomain. Directors, principals, and secretaries
              authenticate here without manually selecting a tenant.
            </p>
          </div>

          <div className="flex items-center justify-center">
            <LoginForm initialTenantSlug={tenantSlug} />
          </div>
        </div>
      </div>
    </div>
  );
}
