"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Building2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";

import { login } from "@/lib/auth/auth";

type FormValues = {
  email: string;
  password: string;
};

export default function SaaSLoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const adminHost = process.env.NEXT_PUBLIC_ADMIN_HOST || "admin.shulehq.co.ke";

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

  useEffect(() => {
    if (serverError) toast.error(serverError);
  }, [serverError]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#efe3c8_0%,#f7f2e8_34%,#fcfbf7_100%)] p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-8 rounded-[2rem] border border-white/60 bg-white/82 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur lg:grid-cols-[minmax(18rem,0.92fr)_minmax(20rem,1.08fr)] lg:p-8">
          <div className="space-y-5 rounded-[1.5rem] bg-slate-950 p-6 text-white">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">
              <LockKeyhole className="size-3.5" />
              Operator Control Plane
            </div>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight">Admin workspace</h1>
              <p className="text-sm leading-6 text-slate-300">
                Platform administration, rollout oversight, billing controls, and support operations are isolated on the admin host.
              </p>
            </div>
            <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 size-4 text-amber-300" />
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Admin host</p>
                  <p className="mt-1 text-sm font-medium text-white">{adminHost}</p>
                </div>
              </div>
            </div>
            <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
              School teams do not sign in here. Each tenant uses its own mapped workspace such as
              <span className="ml-1 font-medium text-white">novel-school.shulehq.co.ke</span>.
            </div>
          </div>

          <div className="flex items-center justify-center">
            <Card className="w-full max-w-md rounded-[1.75rem] border-slate-200/80 shadow-none">
              <CardHeader className="space-y-3">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600">
                  <ShieldCheck className="size-3.5 text-[#b9512d]" />
                  Secure SaaS Access
                </div>
                <div>
                  <CardTitle>SaaS admin sign-in</CardTitle>
                  <CardDescription className="mt-2">
                    Authenticate as the platform operator. Tenant selection is not used on this host.
                  </CardDescription>
                </div>
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

                  <Button
                    className="w-full rounded-full bg-slate-950 text-white hover:bg-slate-800"
                    disabled={isSubmitting}
                    type="submit"
                  >
                    {isSubmitting ? "Signing in..." : "Sign in"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
