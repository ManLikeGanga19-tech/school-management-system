"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { storage, keys } from "@/lib/storage"; // ✅ add this
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
   *  read-only notice is shown. The credentials are public by design (the demo
   *  cannot write anything). */
  demoPrefill?: { email: string; password: string };
};

function getErrorMessage(data: any) {
  if (!data) return "Login failed";
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  return "Login failed";
}

export function LoginForm({ initialTenantSlug, turnstileSiteKey, demoPrefill }: LoginFormProps) {
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    defaultValues: {
      email: demoPrefill?.email ?? "",
      password: demoPrefill?.password ?? "",
    },
  });

  const loading = form.formState.isSubmitting;

  // When Turnstile is enabled we must wait for it to issue a token before the
  // backend will accept the login (the WAF doesn't cover /api/*). Gating the
  // button on the token prevents the "submitted before the token arrived" race
  // that surfaced as "Human verification failed" — worst on the pre-filled demo.
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
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErr(getErrorMessage(data));
      return;
    }

    // ✅ CRITICAL: persist tenant context for apiFetch tenantRequired calls
    storage.remove(keys.saasAccessToken);
    storage.remove(keys.tenantId);
    storage.set(keys.mode, "tenant");
    if (initialTenantSlug) {
      storage.set(keys.tenantSlug, initialTenantSlug);
    }
    if (typeof data?.tenant_id === "string" && data.tenant_id.trim()) {
      storage.set(keys.tenantId, data.tenant_id.trim());
    }

    // Optional: if your /api/auth/login ever returns access_token, store it
    // (won't break anything if absent)
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

    // Use hard navigation to guarantee fresh server render with newly-set auth cookies.
    window.location.assign(safeNext || serverRedirect);
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{demoPrefill ? "Explore the ShuleHQ demo" : "Sign in"}</CardTitle>
        <CardDescription>
          {demoPrefill
            ? "Read-only demo — sign in below (already filled in) and click around freely. Changes are disabled."
            : initialTenantSlug
            ? `Sign in to ${initialTenantSlug}.`
            : "Sign in through your school's mapped subdomain."}
        </CardDescription>
      </CardHeader>
      {demoPrefill && (
        <div className="mx-6 -mt-2 mb-2 rounded-lg border border-amber-brown/25 bg-light-sand/60 px-4 py-2.5 text-sm font-medium text-amber-brown">
          You&apos;re viewing a live, <strong>read-only</strong> demo. Explore every module — nothing you do is saved.
        </div>
      )}

      <CardContent>
        {err && <div className="mb-3 text-sm text-red-600">{err}</div>}

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              placeholder="director@demo.com"
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              {...form.register("email", { required: true })}
            />
          </div>

          <div className="space-y-2">
            <Label>Password</Label>
            <PasswordInput
              placeholder="Enter your password"
              {...form.register("password", { required: true })}
            />
          </div>

          {/* Renders nothing until a site key is configured server-side, so the
              form is unchanged while Turnstile is rolled out. In managed mode
              it stays invisible for legitimate users and only becomes
              interactive when Cloudflare's scoring calls for it. */}
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

          <Button type="submit" className="w-full" disabled={loading || awaitingTurnstile}>
            {loading ? "Signing in..." : awaitingTurnstile ? "Verifying…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
