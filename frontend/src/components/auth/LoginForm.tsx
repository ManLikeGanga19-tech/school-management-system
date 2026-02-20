"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type LoginValues = {
  tenant_slug: string;
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
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    defaultValues: {
      tenant_slug: (initialTenantSlug || "").trim().toLowerCase(),
      email: "",
      password: "",
    },
  });

  const loading = form.formState.isSubmitting;

  async function onSubmit(values: LoginValues) {
    setErr(null);

    const tenant_slug = values.tenant_slug.trim().toLowerCase();
    if (!tenant_slug) {
      setErr("Please enter your school/tenant code (tenant slug).");
      return;
    }

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        tenant_slug,
        email: values.email.trim().toLowerCase(),
        password: values.password,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErr(getErrorMessage(data));
      return;
    }

    router.replace("/dashboard");
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your school code then sign in.</CardDescription>
      </CardHeader>

      <CardContent>
        {err && <div className="mb-3 text-sm text-red-600">{err}</div>}

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>School Code (Tenant)</Label>
            <Input
              placeholder="e.g. demo-school"
              autoCapitalize="none"
              autoCorrect="off"
              {...form.register("tenant_slug", { required: true })}
            />
          </div>

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