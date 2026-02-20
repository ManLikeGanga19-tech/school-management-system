// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TENANT_LOGIN = "/login";
const TENANT_HOME = "/dashboard";
const SAAS_LOGIN = "/saas/login";
const SAAS_HOME = "/saas/dashboard";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const isSaasRoute = pathname === "/saas" || pathname.startsWith("/saas/");
  const isTenantLogin = pathname === TENANT_LOGIN;
  const isSaasLogin = pathname === SAAS_LOGIN;
  const isChooseTenant = pathname.startsWith("/choose-tenant");

  const tenantAccess = req.cookies.get("sms_access")?.value || "";
  const saasAccess = req.cookies.get("sms_saas_access")?.value || "";

  const isPublic = isTenantLogin || isSaasLogin || isChooseTenant;

  if (isPublic) {
    if (isSaasLogin && saasAccess) {
      const url = req.nextUrl.clone();
      url.pathname = SAAS_HOME;
      return NextResponse.redirect(url);
    }

    if (isSaasLogin && !saasAccess && tenantAccess) {
      const url = req.nextUrl.clone();
      url.pathname = TENANT_HOME;
      return NextResponse.redirect(url);
    }

    if (isTenantLogin && tenantAccess) {
      const url = req.nextUrl.clone();
      url.pathname = TENANT_HOME;
      return NextResponse.redirect(url);
    }

    if (isTenantLogin && !tenantAccess && saasAccess) {
      const url = req.nextUrl.clone();
      url.pathname = SAAS_HOME;
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  if (isSaasRoute) {
    if (!saasAccess) {
      if (tenantAccess) {
        const url = req.nextUrl.clone();
        url.pathname = TENANT_HOME;
        return NextResponse.redirect(url);
      }

      const url = req.nextUrl.clone();
      url.pathname = SAAS_LOGIN;
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!tenantAccess) {
    if (saasAccess) {
      const url = req.nextUrl.clone();
      url.pathname = SAAS_HOME;
      return NextResponse.redirect(url);
    }

    const url = req.nextUrl.clone();
    url.pathname = TENANT_LOGIN;
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};