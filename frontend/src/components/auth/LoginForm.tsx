"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { storage, keys } from "@/lib/storage"; // ✅ add this

type LoginValues = {
  email: string;
  password: string;
};

type LoginFormProps = {
  initialTenantSlug?: string;
};

function getErrorMessage(data: any) {
  if (!data) return "Login failed";
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  return "Login failed";
}

export function LoginForm({ initialTenantSlug }: LoginFormProps) {
  const [err, setErr] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const loading = form.formState.isSubmitting;

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
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {initialTenantSlug
            ? `Sign in to ${initialTenantSlug}.`
            : "Sign in through your school's mapped subdomain."}
        </CardDescription>
      </CardHeader>

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
            <Input
              placeholder="********"
              type="password"
              {...form.register("password", { required: true })}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
