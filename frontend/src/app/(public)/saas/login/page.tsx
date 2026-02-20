"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { login } from "@/lib/auth/auth";

type FormValues = {
  email: string;
  password: string;
};

export default function SaaSLoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);

    try {
      await login({
        mode: "saas",
        email: values.email,
        password: values.password,
      });

      router.replace("/saas/dashboard");
    } catch (err: any) {
      setServerError(err?.message || "Login failed. Please check your credentials.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <div className="w-full max-w-md space-y-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>SaaS Admin Login</CardTitle>
            <CardDescription>
              Login as the platform operator (SUPER_ADMIN). No tenant selection required.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {serverError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div className="space-y-1">
                <Input
                  placeholder="Email"
                  autoComplete="email"
                  {...register("email", {
                    required: "Email is required",
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: "Enter a valid email",
                    },
                  })}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              <div className="space-y-1">
                <Input
                  placeholder="Password"
                  type="password"
                  autoComplete="current-password"
                  {...register("password", {
                    required: "Password is required",
                    minLength: { value: 6, message: "Minimum 6 characters" },
                  })}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              <Button className="w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <div className="pt-2 text-center text-sm text-muted-foreground">
              Not a SaaS Admin?{" "}
              <Link href="/choose-tenant" className="text-foreground underline underline-offset-4">
                Login as School User
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          Tip: Ensure your SUPER_ADMIN role is assigned globally (tenant_id = NULL) in{" "}
          <code>core.user_roles</code>.
        </p>
      </div>
    </div>
  );
}
