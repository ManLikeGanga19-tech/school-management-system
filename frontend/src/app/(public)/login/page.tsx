import { cookies } from "next/headers";
import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";

export default async function LoginPage() {
  const tenantSlug = (await cookies()).get("sms_tenant_slug")?.value;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border rounded-xl p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <Link className="text-sm underline" href="/choose-tenant">
            Change tenant
          </Link>
        </div>

        <p className="text-sm text-muted-foreground mt-2">
          Tenant: <span className="font-medium">{tenantSlug || "not set"}</span>
        </p>

        <div className="mt-6">
          <LoginForm initialTenantSlug={tenantSlug || ""} />
        </div>
      </div>
    </div>
  );
}