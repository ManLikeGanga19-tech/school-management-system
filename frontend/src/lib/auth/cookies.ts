import { cookies } from "next/headers";

export const COOKIE_ACCESS = "sms_access";
export const COOKIE_REFRESH = "sms_refresh";
export const COOKIE_TENANT_ID = "sms_tenant_id";
export const COOKIE_TENANT_SLUG = "sms_tenant_slug";

export const COOKIE_SAAS_ACCESS = "sms_saas_access";
export const COOKIE_SAAS_REFRESH = "sms_saas_refresh";

const IS_SECURE = process.env.NODE_ENV === "production";

export async function setAccessToken(token: string) {
  (await cookies()).set(COOKIE_ACCESS, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_SECURE,
    path: "/",
  });
}

export async function setRefreshToken(token: string) {
  (await cookies()).set(COOKIE_REFRESH, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_SECURE,
    path: "/",
  });
}

export async function setSaasAccessToken(token: string) {
  (await cookies()).set(COOKIE_SAAS_ACCESS, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_SECURE,
    path: "/",
  });
}

export async function setSaasRefreshToken(token: string) {
  (await cookies()).set(COOKIE_SAAS_REFRESH, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_SECURE,
    path: "/",
  });
}

export async function clearTenantAuthCookies() {
  const c = await cookies();
  c.delete(COOKIE_ACCESS);
  c.delete(COOKIE_REFRESH);
  c.delete(COOKIE_TENANT_ID);
  c.delete(COOKIE_TENANT_SLUG);
}

export async function clearSaasAuthCookies() {
  const c = await cookies();
  c.delete(COOKIE_SAAS_ACCESS);
  c.delete(COOKIE_SAAS_REFRESH);
}

export async function clearAllAuthCookies() {
  await clearTenantAuthCookies();
  await clearSaasAuthCookies();
}

export async function setTenantContext(input: { tenant_id?: string; tenant_slug?: string }) {
  const c = await cookies();

  if (input.tenant_id) {
    c.set(COOKIE_TENANT_ID, input.tenant_id, {
      path: "/",
      sameSite: "lax",
      secure: IS_SECURE,
      httpOnly: true,
    });
  }

  if (input.tenant_slug) {
    c.set(COOKIE_TENANT_SLUG, input.tenant_slug, {
      path: "/",
      sameSite: "lax",
      secure: IS_SECURE,
      httpOnly: true,
    });
  }
}