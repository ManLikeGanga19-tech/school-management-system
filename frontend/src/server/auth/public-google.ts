const DEV_PUBLIC_OAUTH_BRIDGE_SECRET = "dev-public-oauth-bridge-secret";

export const PUBLIC_GOOGLE_STATE_COOKIE = "sms_public_google_state";
export const PUBLIC_GOOGLE_RETURN_TO_COOKIE = "sms_public_google_return_to";
export const PUBLIC_GOOGLE_FALLBACK_COOKIE = "sms_public_google_fallback";

export function oauthCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  };
}

export function sanitizeRelativeReturnTarget(value: string | null | undefined, fallback: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  if (!normalized.startsWith("/")) return fallback;
  if (normalized.startsWith("//")) return fallback;
  return normalized;
}

export function resolveGoogleRedirectUri(requestUrl: URL) {
  const configured = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
  if (configured) return configured;
  return `${requestUrl.origin}/api/prospect/auth/google/callback`;
}

export function resolvePublicOauthBridgeSecret() {
  const configured = String(process.env.PUBLIC_OAUTH_SHARED_SECRET || "").trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return DEV_PUBLIC_OAUTH_BRIDGE_SECRET;
  return "";
}

export function resolveGoogleOauthConfig(requestUrl: URL) {
  return {
    clientId: String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim(),
    redirectUri: resolveGoogleRedirectUri(requestUrl),
  };
}
