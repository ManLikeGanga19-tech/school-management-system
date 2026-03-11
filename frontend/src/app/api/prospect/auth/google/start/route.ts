import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  oauthCookieOptions,
  PUBLIC_GOOGLE_FALLBACK_COOKIE,
  PUBLIC_GOOGLE_RETURN_TO_COOKIE,
  PUBLIC_GOOGLE_STATE_COOKIE,
  resolveGoogleOauthConfig,
  sanitizeRelativeReturnTarget,
} from "@/server/auth/public-google";

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const flow = requestUrl.searchParams.get("flow") === "login" ? "login" : "register";
  const fallback = flow === "login" ? "/sign-in" : "/create-access";
  const returnTo = sanitizeRelativeReturnTarget(requestUrl.searchParams.get("return_to"), "/#engage");
  const { clientId, clientSecret, redirectUri } = resolveGoogleOauthConfig(requestUrl);

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL(`${fallback}?oauth_error=google_not_configured`, requestUrl.origin));
  }

  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set(PUBLIC_GOOGLE_STATE_COOKIE, state, oauthCookieOptions());
  cookieStore.set(PUBLIC_GOOGLE_RETURN_TO_COOKIE, returnTo, oauthCookieOptions());
  cookieStore.set(PUBLIC_GOOGLE_FALLBACK_COOKIE, fallback, oauthCookieOptions());

  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.searchParams.set("client_id", clientId);
  googleUrl.searchParams.set("redirect_uri", redirectUri);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", state);
  googleUrl.searchParams.set("prompt", "select_account");
  googleUrl.searchParams.set("include_granted_scopes", "true");

  return NextResponse.redirect(googleUrl);
}
