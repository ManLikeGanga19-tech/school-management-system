// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { expiredCookieVariants } from "./src/lib/auth/cookie-config";
import { isJwtLive } from "./src/lib/auth/jwt";
import { resolveAdminPortalUrl, resolvePortalContext } from "./src/lib/platform-host";

const TENANT_LOGIN = "/login";
const TENANT_HOME = "/dashboard";
const SAAS_LOGIN = "/saas/login";
const SAAS_HOME = "/saas/dashboard";

function clearCookies(response: NextResponse, names: string[]) {
  for (const name of names) {
    for (const variant of expiredCookieVariants()) {
      response.cookies.set(name, "", variant);
    }
  }
}

function authState(accessToken: string, refreshToken: string) {
  const accessLive = isJwtLive(accessToken);
  const refreshLive = isJwtLive(refreshToken);
  const stale = Boolean(accessToken || refreshToken) && !accessLive && !refreshLive;
  return {
    hasSession: accessLive || (Boolean(accessToken) && refreshLive),
    stale,
  };
}

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
  const isProspectAuthRoute = pathname === "/sign-in" || pathname === "/create-access";

  const tenantAccess = req.cookies.get("sms_access")?.value || "";
  const tenantRefresh = req.cookies.get("sms_refresh")?.value || "";
  const saasAccess = req.cookies.get("sms_saas_access")?.value || "";
  const saasRefresh = req.cookies.get("sms_saas_refresh")?.value || "";
  const tenantAuth = authState(tenantAccess, tenantRefresh);
  const saasAuth = authState(saasAccess, saasRefresh);

  function redirectWithCleanup(url: URL | string, cookieNames: string[]) {
    const response =
      typeof url === "string"
        ? NextResponse.redirect(url)
        : NextResponse.redirect(url);
    clearCookies(response, cookieNames);
    return response;
  }

  if (portal.kind === "admin") {
    if (isLandingPage) {
      const url = req.nextUrl.clone();
      url.pathname = saasAuth.hasSession ? SAAS_HOME : SAAS_LOGIN;
      return NextResponse.redirect(url);
    }

    if (pathname === "/login") {
      const url = req.nextUrl.clone();
      url.pathname = SAAS_LOGIN;
      return NextResponse.redirect(url);
    }

    if (isSaasLogin) {
      if (saasAuth.hasSession) {
        const url = req.nextUrl.clone();
        url.pathname = SAAS_HOME;
        return NextResponse.redirect(url);
      }
      if (saasAuth.stale) {
        return redirectWithCleanup(req.nextUrl, [
          "sms_saas_access",
          "sms_saas_refresh",
          "sms_mode",
        ]);
      }
      return NextResponse.next();
    }

    if (isSaasRoute) {
      if (!saasAuth.hasSession) {
        const url = req.nextUrl.clone();
        url.pathname = SAAS_LOGIN;
        url.searchParams.set("next", pathname);
        if (saasAuth.stale) {
          return redirectWithCleanup(url, [
            "sms_saas_access",
            "sms_saas_refresh",
            "sms_mode",
          ]);
        }
        return NextResponse.redirect(url);
      }
      return NextResponse.next();
    }

    const url = req.nextUrl.clone();
    url.pathname = saasAuth.hasSession ? SAAS_HOME : SAAS_LOGIN;
    return NextResponse.redirect(url);
  }

  if (portal.kind === "tenant") {
    if (isLandingPage) {
      const url = req.nextUrl.clone();
      url.pathname = tenantAuth.hasSession ? TENANT_HOME : TENANT_LOGIN;
      return NextResponse.redirect(url);
    }

    if (isChooseTenant || isSaasLogin || isSaasRoute) {
      const url = req.nextUrl.clone();
      url.pathname = tenantAuth.hasSession ? TENANT_HOME : TENANT_LOGIN;
      return NextResponse.redirect(url);
    }

    if (isTenantLogin) {
      if (tenantAuth.hasSession) {
        const url = req.nextUrl.clone();
        url.pathname = TENANT_HOME;
        return NextResponse.redirect(url);
      }
      if (tenantAuth.stale) {
        return redirectWithCleanup(req.nextUrl, [
          "sms_access",
          "sms_refresh",
          "sms_tenant_id",
          "sms_tenant_slug",
          "sms_mode",
        ]);
      }
      return NextResponse.next();
    }

    if (!tenantAuth.hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = TENANT_LOGIN;
      url.searchParams.set("next", pathname);
      if (tenantAuth.stale) {
        return redirectWithCleanup(url, [
          "sms_access",
          "sms_refresh",
          "sms_tenant_id",
          "sms_tenant_slug",
          "sms_mode",
        ]);
      }
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  if (isTenantLogin || isChooseTenant) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (isProspectAuthRoute) {
    return NextResponse.next();
  }

  if (isSaasLogin || isSaasRoute) {
    const target =
      resolveAdminPortalUrl(
        saasAuth.hasSession ? SAAS_HOME : `${SAAS_LOGIN}?next=${encodeURIComponent(pathname)}`,
        portal.hostname
      ) ||
      (saasAuth.hasSession ? SAAS_HOME : SAAS_LOGIN);
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

  if (saasAuth.hasSession) {
    return NextResponse.redirect(resolveAdminPortalUrl(SAAS_HOME, portal.hostname) || "/");
  }

  const url = req.nextUrl.clone();
  url.pathname = "/";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
