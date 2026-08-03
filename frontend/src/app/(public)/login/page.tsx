import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import { LoginForm } from "@/components/auth/LoginForm";
import { ShuleHQLogo } from "@/components/brand/ShuleHQLogo";
import { resolvePortalContext } from "@/lib/platform-host";
import { backendFetch } from "@/server/backend/client";

const DEFAULT_ACCENT = "#b9512d"; // brand-primary
const HEX = /^#[0-9a-fA-F]{6}$/;

type TenantBrand = {
  slug: string;
  name: string;
  brand_color: string | null;
  badge_url: string | null;
  school_phone: string | null;
  school_email: string | null;
};

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "S";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function fetchBrand(slug: string): Promise<TenantBrand | null> {
  if (!slug) return null;
  try {
    const res = await backendFetch(
      `/api/v1/public/tenant-brand?slug=${encodeURIComponent(slug)}`,
      { method: "GET", cache: "no-store" }
    );
    if (!res.ok) return null;
    return (await res.json()) as TenantBrand;
  } catch {
    return null;
  }
}

/** A school badge if uploaded, otherwise a monogram of the school's initials. */
function BrandMark({
  badgeUrl,
  name,
  accent,
  size,
}: {
  badgeUrl: string | null;
  name: string;
  accent: string;
  size: "sm" | "lg";
}) {
  const dim = size === "lg" ? "h-24 w-24" : "h-12 w-12";
  const text = size === "lg" ? "text-3xl" : "text-lg";
  if (badgeUrl) {
    return (
      <div className={`relative ${dim} overflow-hidden rounded-2xl bg-white/95 shadow-lg ring-1 ring-black/5`}>
        <Image src={badgeUrl} alt={`${name} badge`} fill className="object-contain p-2" />
      </div>
    );
  }
  return (
    <div
      className={`flex ${dim} items-center justify-center rounded-2xl font-bold text-white shadow-lg ${text}`}
      style={{ backgroundColor: accent }}
    >
      {initials(name)}
    </div>
  );
}

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

  const brand = await fetchBrand(tenantSlug);
  const schoolName = brand?.name || titleCaseSlug(tenantSlug) || "Your School";
  const accent = brand?.brand_color && HEX.test(brand.brand_color) ? brand.brand_color : DEFAULT_ACCENT;
  const badgeUrl = brand?.badge_url || null;

  return (
    <div className="flex min-h-screen bg-page-bg">
      {/* LEFT — full-height brand panel (badge/monogram), desktop only */}
      <aside
        className="relative hidden w-[42%] flex-col justify-between overflow-hidden p-12 text-white lg:flex xl:w-[45%]"
        style={{ background: `linear-gradient(160deg, ${accent} 0%, #132129 100%)` }}
      >
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-black/20 blur-3xl" />

        <div className="relative z-10 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
          <ShuleHQLogo theme="dark" size={28} />
        </div>

        <div className="relative z-10 flex flex-col items-start gap-8">
          <BrandMark badgeUrl={badgeUrl} name={schoolName} accent="#ffffff20" size="lg" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-white/60">School workspace</p>
            <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight xl:text-5xl">{schoolName}</h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-white/70">
              Sign in to manage students, assessments, fees and parent communication — all in one place.
            </p>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs font-medium text-white/50">
          <span>Powered by ShuleHQ</span>
          <span className="h-1 w-1 rounded-full bg-white/40" />
          <span>CBC &amp; KEMIS-aligned</span>
        </div>
      </aside>

      {/* RIGHT — the sign-in form */}
      <main className="flex w-full flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          {/* Compact brand header — mobile only (left panel is hidden there) */}
          <div className="mb-8 flex flex-col items-center gap-4 text-center lg:hidden">
            <BrandMark badgeUrl={badgeUrl} name={schoolName} accent={accent} size="sm" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-dark-navy">{schoolName}</h1>
              <p className="mt-1 text-sm text-muted-text">School workspace</p>
            </div>
          </div>

          <LoginForm
            initialTenantSlug={tenantSlug}
            turnstileSiteKey={process.env.TURNSTILE_SITE_KEY}
            schoolName={schoolName}
            accentColor={accent}
            contactPhone={brand?.school_phone ?? null}
            contactEmail={brand?.school_email ?? null}
            demoPrefill={
              tenantSlug === (process.env.DEMO_TENANT_SLUG || "demo")
                ? {
                    email: process.env.DEMO_EMAIL || "director@demo.shulehq.co.ke",
                    password: process.env.DEMO_PASSWORD || "Demo@2026",
                  }
                : undefined
            }
          />

          <p className="mt-8 text-center text-xs text-muted-text/70">
            © {new Date().getFullYear()} ShuleHQ ·{" "}
            <a href="https://shulehq.co.ke/terms" className="hover:text-brand-primary hover:underline">Terms</a>
            {" · "}
            <a href="https://shulehq.co.ke/privacy" className="hover:text-brand-primary hover:underline">Privacy</a>
          </p>
        </div>
      </main>
    </div>
  );
}
