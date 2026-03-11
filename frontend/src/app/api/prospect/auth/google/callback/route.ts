import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { backendFetch } from "@/server/backend/client";
import { syncPublicSession } from "@/server/backend/prospect-client";
import {
  oauthCookieOptions,
  PUBLIC_GOOGLE_FALLBACK_COOKIE,
  PUBLIC_GOOGLE_RETURN_TO_COOKIE,
  PUBLIC_GOOGLE_STATE_COOKIE,
  resolvePublicOauthBridgeSecret,
  resolveGoogleOauthConfig,
} from "@/server/auth/public-google";

function clearOauthCookies(response: NextResponse) {
  const expired = { ...oauthCookieOptions(), maxAge: 0 };
  response.cookies.set(PUBLIC_GOOGLE_STATE_COOKIE, "", expired);
  response.cookies.set(PUBLIC_GOOGLE_RETURN_TO_COOKIE, "", expired);
  response.cookies.set(PUBLIC_GOOGLE_FALLBACK_COOKIE, "", expired);
}

function errorRedirect(requestUrl: URL, fallback: string, code: string) {
  const response = NextResponse.redirect(new URL(`${fallback}?oauth_error=${encodeURIComponent(code)}`, requestUrl.origin));
  clearOauthCookies(response);
  return response;
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const cookieStore = await cookies();
  const fallback = cookieStore.get(PUBLIC_GOOGLE_FALLBACK_COOKIE)?.value || "/sign-in";
  const returnTo = cookieStore.get(PUBLIC_GOOGLE_RETURN_TO_COOKIE)?.value || "/#engage";
  const expectedState = cookieStore.get(PUBLIC_GOOGLE_STATE_COOKIE)?.value || "";
  const state = requestUrl.searchParams.get("state") || "";
  const code = requestUrl.searchParams.get("code") || "";
  const oauthError = requestUrl.searchParams.get("error") || "";

  if (oauthError) {
    return errorRedirect(requestUrl, fallback, oauthError);
  }
  if (!state || !expectedState || state !== expectedState) {
    return errorRedirect(requestUrl, fallback, "google_state_mismatch");
  }
  if (!code) {
    return errorRedirect(requestUrl, fallback, "google_missing_code");
  }

  const { clientId, clientSecret, redirectUri } = resolveGoogleOauthConfig(requestUrl);
  const bridgeSecret = resolvePublicOauthBridgeSecret();
  if (!clientId || !clientSecret || !bridgeSecret) {
    return errorRedirect(requestUrl, fallback, "google_not_configured");
  }

  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
      cache: "no-store",
    });
  } catch {
    return errorRedirect(requestUrl, fallback, "google_token_exchange_failed");
  }

  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData?.access_token) {
    return errorRedirect(requestUrl, fallback, "google_token_exchange_failed");
  }

  let userInfoResponse: Response;
  try {
    userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      cache: "no-store",
    });
  } catch {
    return errorRedirect(requestUrl, fallback, "google_userinfo_failed");
  }

  const userInfo = await userInfoResponse.json().catch(() => ({}));
  if (!userInfoResponse.ok || !userInfo?.email || !userInfo?.sub || !userInfo?.email_verified) {
    return errorRedirect(requestUrl, fallback, "google_userinfo_failed");
  }

  let authResponse: Response;
  try {
    authResponse = await backendFetch("/api/v1/public/auth/oauth/google", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-public-oauth-secret": bridgeSecret,
      },
      body: JSON.stringify({
        email: userInfo.email,
        full_name: userInfo.name || userInfo.email,
        organization_name: userInfo.hd || null,
        provider_subject: userInfo.sub,
      }),
      cache: "no-store",
    });
  } catch {
    return errorRedirect(requestUrl, fallback, "prospect_oauth_bridge_failed");
  }

  const authData = await authResponse.json().catch(() => ({}));
  if (!authResponse.ok) {
    return errorRedirect(
      requestUrl,
      fallback,
      typeof authData?.detail === "string" && authData.detail.trim()
        ? authData.detail.trim().toLowerCase().replace(/\s+/g, "_")
        : "prospect_oauth_bridge_failed"
    );
  }

  await syncPublicSession(authResponse, authData);
  const response = NextResponse.redirect(new URL(returnTo, requestUrl.origin));
  clearOauthCookies(response);
  return response;
}
