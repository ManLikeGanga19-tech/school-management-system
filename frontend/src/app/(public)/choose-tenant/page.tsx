import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { clearAllAuthCookies, setTenantContext } from "@/lib/auth/cookies";

export default function ChooseTenantPage() {
  async function setTenant(formData: FormData) {
    "use server";

    const slug = String(formData.get("tenant_slug") || "").trim().toLowerCase();
    if (!slug) redirect("/choose-tenant");

    await clearAllAuthCookies();
    await setTenantContext({ tenant_slug: slug });

    redirect("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <div className="w-full max-w-md space-y-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Choose School (Tenant)</CardTitle>
            <CardDescription>
              For development: enter tenant slug. In production you can resolve by domain.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <form action={setTenant} className="space-y-3">
              <Input name="tenant_slug" placeholder="e.g. ics-college" />
              <Button type="submit" className="w-full">
                Continue as School User
              </Button>
            </form>

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-muted/30 px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Link href="/saas/login" className="block">
              <Button variant="secondary" className="w-full">
                Login as SaaS Admin
              </Button>
            </Link>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          School logins require tenant context. SaaS Admin manages all tenants globally.
        </p>
      </div>
    </div>
  );
}
