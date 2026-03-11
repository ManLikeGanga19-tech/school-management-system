// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveAdminPortalUrl, resolvePortalContext } from "./src/lib/platform-host";

const TENANT_LOGIN = "/login";
const TENANT_HOME = "/dashboard";
const SAAS_LOGIN = "/saas/login";
const SAAS_HOME = "/saas/dashboard";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const portal = resolvePortalContext(
    req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  );

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
  const isLandingPage = pathname === "/";

  const tenantAccess = req.cookies.get("sms_access")?.value || "";
  const saasAccess = req.cookies.get("sms_saas_access")?.value || "";

  if (portal.kind === "admin") {
    if (isLandingPage) {
      const url = req.nextUrl.clone();
      url.pathname = saasAccess ? SAAS_HOME : SAAS_LOGIN;
      return NextResponse.redirect(url);
    }

    if (pathname === "/login") {
      const url = req.nextUrl.clone();
      url.pathname = SAAS_LOGIN;
      return NextResponse.redirect(url);
    }

    if (isSaasLogin) {
      if (saasAccess) {
        const url = req.nextUrl.clone();
        url.pathname = SAAS_HOME;
        return NextResponse.redirect(url);
      }
      return NextResponse.next();
    }

    if (isSaasRoute) {
      if (!saasAccess) {
        const url = req.nextUrl.clone();
        url.pathname = SAAS_LOGIN;
        url.searchParams.set("next", pathname);
        return NextResponse.redirect(url);
      }
      return NextResponse.next();
    }

    const url = req.nextUrl.clone();
    url.pathname = saasAccess ? SAAS_HOME : SAAS_LOGIN;
    return NextResponse.redirect(url);
  }

  if (portal.kind === "tenant") {
    if (isLandingPage) {
      const url = req.nextUrl.clone();
      url.pathname = tenantAccess ? TENANT_HOME : TENANT_LOGIN;
      return NextResponse.redirect(url);
    }

    if (isChooseTenant || isSaasLogin || isSaasRoute) {
      const url = req.nextUrl.clone();
      url.pathname = tenantAccess ? TENANT_HOME : TENANT_LOGIN;
      return NextResponse.redirect(url);
    }

    if (isTenantLogin) {
      if (tenantAccess) {
        const url = req.nextUrl.clone();
        url.pathname = TENANT_HOME;
        return NextResponse.redirect(url);
      }
      return NextResponse.next();
    }

    if (!tenantAccess) {
      const url = req.nextUrl.clone();
      url.pathname = TENANT_LOGIN;
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  if (isTenantLogin || isChooseTenant) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (isSaasLogin || isSaasRoute) {
    const target =
      resolveAdminPortalUrl(
        saasAccess ? SAAS_HOME : `${SAAS_LOGIN}?next=${encodeURIComponent(pathname)}`,
        portal.hostname
      ) ||
      (saasAccess ? SAAS_HOME : SAAS_LOGIN);
    return NextResponse.redirect(target);
  }

  if (isLandingPage) {
    return NextResponse.next();
  }

  if (isSaasRoute) {
    if (!saasAccess) {
      if (tenantAccess) {
        const url = req.nextUrl.clone();
        url.pathname = TENANT_HOME;
        return NextResponse.redirect(url);
      }

      return NextResponse.redirect(resolveAdminPortalUrl(`${SAAS_LOGIN}?next=${encodeURIComponent(pathname)}`) || "/");
    }
    return NextResponse.next();
  }

  if (saasAccess) {
    return NextResponse.redirect(resolveAdminPortalUrl(SAAS_HOME, portal.hostname) || "/");
  }

  const url = req.nextUrl.clone();
  url.pathname = "/";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
