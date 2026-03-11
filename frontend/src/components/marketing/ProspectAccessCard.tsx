"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogOut, Rocket, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/sonner";

type AuthMode = "register" | "login";

type ProspectAccount = {
  id: string;
  email: string;
  full_name: string;
  organization_name: string;
  phone?: string | null;
  job_title?: string | null;
  is_active: boolean;
};

const initialRegisterState = {
  full_name: "",
  organization_name: "",
  phone: "",
  job_title: "",
  email: "",
  password: "",
};

const initialLoginState = {
  email: "",
  password: "",
};

function getErrorMessage(data: any, fallback: string) {
  if (!data) return fallback;
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  return fallback;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4a9.6 9.6 0 1 0 0 19.2c5.5 0 9.1-3.8 9.1-9.1 0-.6-.1-1.1-.2-1.6H12Z" />
      <path fill="#34A853" d="M6 14a6 6 0 0 0 9.3 3.2l2.8 2.2A9.6 9.6 0 0 1 2.4 12c0-1.5.4-2.9 1-4.2L6.7 10A5.8 5.8 0 0 0 6 14Z" />
      <path fill="#4A90E2" d="M21.1 12.5c0-.6-.1-1.1-.2-1.6H12v3.2h5.1c-.2 1-.8 1.9-1.8 2.5l2.8 2.2c1.6-1.5 3-3.8 3-6.3Z" />
      <path fill="#FBBC05" d="M3.4 7.8 6.7 10A6 6 0 0 1 12 6c1.8 0 3.4.6 4.6 1.8l2.7-2.6A9.6 9.6 0 0 0 2.4 12c0 1.5.4 2.9 1 4.2L6.7 14a5.8 5.8 0 0 1-.7-2 5.8 5.8 0 0 1 .7-2Z" />
    </svg>
  );
}

function oauthErrorMessage(value: string | null) {
  switch (value) {
    case "google_not_configured":
      return "Google OAuth is not configured yet for this environment.";
    case "google_state_mismatch":
      return "Google sign-in could not be verified. Please try again.";
    case "google_missing_code":
      return "Google sign-in did not return an authorization code.";
    case "google_token_exchange_failed":
      return "Google token exchange failed. Please try again.";
    case "google_userinfo_failed":
      return "Google account details could not be verified.";
    case "prospect_account_is_inactive":
      return "This prospect account is inactive. Contact support.";
    case "prospect_oauth_bridge_failed":
      return "Prospect sign-in could not be completed. Please try again.";
    default:
      return value ? `Google sign-in failed: ${value.replace(/_/g, " ")}` : null;
  }
}

export function ProspectAccessCard({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [account, setAccount] = useState<ProspectAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [registerState, setRegisterState] = useState(initialRegisterState);
  const [loginState, setLoginState] = useState(initialLoginState);

  const googleOauthPath = useMemo(
    () => `/api/prospect/auth/google/start?flow=${mode}&return_to=${encodeURIComponent("/#engage")}`,
    [mode]
  );

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      try {
        const res = await fetch("/api/prospect/auth/me", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (!res.ok) {
          if (active) setAccount(null);
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (active) setAccount((data?.account as ProspectAccount | undefined) || null);
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const message = oauthErrorMessage(searchParams.get("oauth_error"));
    if (message) toast.error(message);
  }, [searchParams]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const path = mode === "register" ? "/api/prospect/auth/register" : "/api/prospect/auth/login";
      const payload = mode === "register" ? registerState : loginState;

      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(getErrorMessage(data, mode === "register" ? "Account creation failed" : "Login failed"));
      }

      const nextAccount = (data?.account as ProspectAccount | undefined) || null;
      setAccount(nextAccount);
      setRegisterState(initialRegisterState);
      setLoginState(initialLoginState);
      toast.success(mode === "register" ? "Prospect access created." : "Signed in successfully.");
      router.push("/#engage");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message || "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/prospect/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    setAccount(null);
    toast.success("Signed out.");
    router.refresh();
  }

  if (loading) {
    return (
      <Card className="w-full rounded-[1.9rem] border-slate-200/80 bg-white/94 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
        <CardContent className="flex min-h-72 items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading access workspace...
        </CardContent>
      </Card>
    );
  }

  if (account) {
    return (
      <Card className="w-full rounded-[1.9rem] border-slate-200/80 bg-white/94 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
        <CardHeader className="space-y-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600">
            <ShieldCheck className="size-3.5 text-[#b9512d]" />
            Prospect Workspace Active
          </div>
          <CardTitle>Continue to the rollout desk</CardTitle>
          <CardDescription>
            {account.full_name} is already signed in for {account.organization_name}. Continue to the guided request desk to submit or manage rollout requests.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full rounded-full bg-slate-950 text-white hover:bg-slate-800" onClick={() => router.push("/#engage")}>
            Open request desk
          </Button>
          <Button variant="outline" className="w-full rounded-full" onClick={handleLogout}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full rounded-[1.9rem] border-slate-200/80 bg-white/94 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
      <CardHeader className="space-y-3">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600">
          <Rocket className="size-3.5 text-[#b9512d]" />
          {mode === "register" ? "Create Prospect Access" : "Prospect Sign In"}
        </div>
        <CardTitle>{mode === "register" ? "Create controlled access" : "Resume your rollout thread"}</CardTitle>
        <CardDescription>
          {mode === "register"
            ? "Create one institution-facing access record before requesting a demo, enquiry, or school visit."
            : "Sign in with the prospect workspace you already created, then continue from the rollout desk."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full border-slate-300 bg-white/95"
              onClick={() => window.location.assign(googleOauthPath)}
            >
              <GoogleMark />
              {mode === "register" ? "Continue with Google" : "Sign in with Google"}
            </Button>
            <p className="text-center text-xs leading-5 text-slate-500">
              Google verification is handled on the public onboarding host and returns you to the rollout desk after authentication.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            <span>Email and password</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {mode === "register" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="register-full-name">Full name</Label>
                  <Input
                    id="register-full-name"
                    value={registerState.full_name}
                    onChange={(e) => setRegisterState((s) => ({ ...s, full_name: e.target.value }))}
                    placeholder="Jane Achieng"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-organization">Institution</Label>
                  <Input
                    id="register-organization"
                    value={registerState.organization_name}
                    onChange={(e) => setRegisterState((s) => ({ ...s, organization_name: e.target.value }))}
                    placeholder="Novel School"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-phone">Phone</Label>
                  <Input
                    id="register-phone"
                    value={registerState.phone}
                    onChange={(e) => setRegisterState((s) => ({ ...s, phone: e.target.value }))}
                    placeholder="+254..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-role">Role</Label>
                  <Input
                    id="register-role"
                    value={registerState.job_title}
                    onChange={(e) => setRegisterState((s) => ({ ...s, job_title: e.target.value }))}
                    placeholder="Director / ICT Lead"
                  />
                </div>
              </>
            )}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="access-email">Work email</Label>
              <Input
                id="access-email"
                type="email"
                value={mode === "register" ? registerState.email : loginState.email}
                onChange={(e) =>
                  mode === "register"
                    ? setRegisterState((s) => ({ ...s, email: e.target.value }))
                    : setLoginState((s) => ({ ...s, email: e.target.value }))
                }
                placeholder="team@school.org"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="access-password">Password</Label>
              <PasswordInput
                id="access-password"
                value={mode === "register" ? registerState.password : loginState.password}
                onChange={(e) =>
                  mode === "register"
                    ? setRegisterState((s) => ({ ...s, password: e.target.value }))
                    : setLoginState((s) => ({ ...s, password: e.target.value }))
                }
                placeholder="Minimum 8 characters"
              />
            </div>

            <div className="sm:col-span-2 pt-2">
              <Button
                className="w-full rounded-full bg-slate-950 text-white hover:bg-slate-800"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting
                  ? mode === "register"
                    ? "Creating access..."
                    : "Signing in..."
                  : mode === "register"
                    ? "Create access"
                    : "Sign in"}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
