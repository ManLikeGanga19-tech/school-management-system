"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { KeyRound, Phone, Mail } from "lucide-react";

import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

import { storage, keys } from "@/lib/storage";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";

type LoginValues = {
  email: string;
  password: string;
};

type LoginFormProps = {
  initialTenantSlug?: string;
  /** Cloudflare Turnstile site key, passed from the server component so it can
   *  change without a rebuild. Absent = widget renders nothing. */
  turnstileSiteKey?: string;
  /** When this is the read-only demo tenant, the login is pre-filled and a
   *  read-only notice is shown. The credentials are public by design. */
  demoPrefill?: { email: string; password: string };
  /** Per-tenant personalisation resolved server-side from the subdomain. */
  schoolName?: string;
  accentColor?: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
};

function getErrorMessage(data: any) {
  if (!data) return "Login failed";
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  return "Login failed";
}

export function LoginForm({
  initialTenantSlug,
  turnstileSiteKey,
  demoPrefill,
  schoolName,
  accentColor = "#b9512d",
  contactPhone,
  contactEmail,
}: LoginFormProps) {
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showForgot, setShowForgot] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    defaultValues: {
      email: demoPrefill?.email ?? "",
      password: demoPrefill?.password ?? "",
    },
  });

  const loading = form.formState.isSubmitting;

  // Wait for Turnstile to issue a token before enabling submit — otherwise the
  // backend rejects the empty token with "Human verification failed".
  const turnstileEnabled = !!turnstileSiteKey;
  const awaitingTurnstile = turnstileEnabled && !turnstileToken && !turnstileError;

  async function onSubmit(values: LoginValues) {
    setErr(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        tenant_slug: (initialTenantSlug || "").trim().toLowerCase(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
        turnstile_token: turnstileToken || undefined,
        remember_me: remember,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErr(getErrorMessage(data));
      return;
    }

    storage.remove(keys.saasAccessToken);
    storage.remove(keys.tenantId);
    storage.set(keys.mode, "tenant");
    if (initialTenantSlug) {
      storage.set(keys.tenantSlug, initialTenantSlug);
    }
    if (typeof data?.tenant_id === "string" && data.tenant_id.trim()) {
      storage.set(keys.tenantId, data.tenant_id.trim());
    }
    if (data?.access_token) {
      storage.set(keys.accessToken, String(data.access_token));
    }

    const query = new URLSearchParams(window.location.search);
    const next = (query.get("next") || "").trim();
    const safeNext = next.startsWith("/") ? next : "";
    const serverRedirect =
      typeof data?.redirect_to === "string" && data.redirect_to.startsWith("/")
        ? data.redirect_to
        : "/dashboard";

    window.location.assign(safeNext || serverRedirect);
  }

  return (
    <div className="w-full">
      <div className="mb-7">
        <h2 className="text-2xl font-bold tracking-tight text-dark-navy">
          {demoPrefill ? "Explore the demo" : "Welcome back"}
        </h2>
        <p className="mt-1.5 text-sm text-muted-text">
          {demoPrefill
            ? "Read-only demo — already filled in. Sign in and click around freely."
            : `Sign in to continue to ${schoolName || "your workspace"}.`}
        </p>
      </div>

      {demoPrefill && (
        <div className="mb-5 rounded-lg border border-amber-brown/25 bg-light-sand/60 px-4 py-2.5 text-sm font-medium text-amber-brown">
          You&apos;re viewing a live, <strong>read-only</strong> demo. Nothing you do is saved.
        </div>
      )}

      {err && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
          {err}
        </div>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            placeholder="you@school.com"
            type="email"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="email"
            {...form.register("email", { required: true })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">Password</Label>
            <button
              type="button"
              onClick={() => setShowForgot((v) => !v)}
              className="text-sm font-medium hover:underline"
              style={{ color: accentColor }}
            >
              Forgot password?
            </button>
          </div>
          <PasswordInput
            id="login-password"
            placeholder="Enter your password"
            autoComplete="current-password"
            {...form.register("password", { required: true })}
          />
        </div>

        {showForgot && (
          <div className="rounded-lg border border-brand-border bg-muted-warm/50 px-4 py-3 text-sm text-muted-text">
            <div className="flex items-start gap-2">
              <KeyRound size={16} className="mt-0.5 shrink-0" style={{ color: accentColor }} />
              <div className="space-y-1.5">
                <p>
                  Password resets are handled by your school. Contact your{" "}
                  <strong className="text-dark-navy">administrator</strong> to have it reset.
                </p>
                {(contactPhone || contactEmail) && (
                  <div className="flex flex-col gap-1 pt-0.5">
                    {contactPhone && (
                      <a href={`tel:${contactPhone}`} className="flex items-center gap-2 font-medium text-dark-navy hover:underline">
                        <Phone size={13} /> {contactPhone}
                      </a>
                    )}
                    {contactEmail && (
                      <a href={`mailto:${contactEmail}`} className="flex items-center gap-2 font-medium text-dark-navy hover:underline">
                        <Mail size={13} /> {contactEmail}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Checkbox
            id="remember"
            checked={remember}
            onCheckedChange={setRemember}
            accentColor={accentColor}
            aria-label="Remember me on this device"
          />
          <label htmlFor="remember" className="cursor-pointer select-none text-sm text-muted-text" onClick={() => setRemember((v) => !v)}>
            Remember me on this device
          </label>
        </div>

        {/* Renders nothing until a site key is configured server-side. */}
        <TurnstileWidget
          siteKey={turnstileSiteKey}
          onToken={(t) => {
            setTurnstileToken(t);
            if (t) setTurnstileError(false);
          }}
          onError={() => setTurnstileError(true)}
        />
        {turnstileError && (
          <p className="text-sm text-amber-brown">
            Couldn&apos;t verify your browser. Please refresh the page and try again.
          </p>
        )}

        <Button
          type="submit"
          className="w-full py-6 text-base font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: accentColor }}
          disabled={loading || awaitingTurnstile}
        >
          {loading ? "Signing in..." : awaitingTurnstile ? "Verifying…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs leading-relaxed text-muted-text/80">
        By signing in you agree to ShuleHQ&apos;s{" "}
        <a href="https://shulehq.co.ke/terms" className="font-medium hover:underline" style={{ color: accentColor }}>
          Terms
        </a>{" "}
        and{" "}
        <a href="https://shulehq.co.ke/privacy" className="font-medium hover:underline" style={{ color: accentColor }}>
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
