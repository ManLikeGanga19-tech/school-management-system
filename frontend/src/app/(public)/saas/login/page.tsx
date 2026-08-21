"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { KeyRound } from "lucide-react";

import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

import { login } from "@/lib/auth/auth";

type FormValues = { email: string; password: string };

export default function SaaSLoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const adminHost =
    typeof window !== "undefined"
      ? window.location.host
      : process.env.NEXT_PUBLIC_ADMIN_HOST || "admin.shulehq.co.ke";

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({ defaultValues: { email: "", password: "" }, mode: "onSubmit" });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await login({ mode: "saas", email: values.email, password: values.password });
      router.replace("/saas/dashboard");
    } catch (err: any) {
      setServerError(err?.message || "Login failed. Please check your credentials.");
    }
  };

  useEffect(() => {
    if (serverError) toast.error(serverError);
  }, [serverError]);

  return (
    <div className="flex min-h-screen bg-page-bg">
      {/* LEFT — operator identity, built around the real ShuleHQ mark */}
      <aside className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-[#0f172a] p-12 text-white lg:flex xl:w-[46%]">
        {/* one restrained gold hairline, no glassy blobs */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f59e0b]/50 to-transparent" />

        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/pwa-icon/admin-icon-192.png" alt="ShuleHQ Admin" className="h-10 w-10 rounded-xl" />
          <span className="text-lg font-bold tracking-tight">
            Shule<span className="text-[#f59e0b]">HQ</span>
            <span className="ml-2 rounded-md bg-[#f59e0b]/15 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f59e0b]">
              Admin
            </span>
          </span>
        </div>

        <div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight xl:text-[2.75rem]">
            Operator control plane
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-white/55">
            Rollout, billing, RBAC and support for the whole ShuleHQ platform — isolated on the admin host, separate from every school workspace.
          </p>

          <div className="mt-8 max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Admin host</p>
            <p className="mt-1 font-mono text-sm font-medium text-white">{adminHost}</p>
            <p className="mt-2 text-xs leading-5 text-white/45">
              Schools never sign in here — each uses its own workspace, e.g.{" "}
              <span className="text-white/70">novel-school.shulehq.co.ke</span>.
            </p>
          </div>
        </div>

        <p className="text-xs font-medium text-white/35">Powered by ShuleHQ · Secure operator access</p>
      </aside>

      {/* RIGHT — clean light form, matching the tenant login */}
      <main className="flex w-full flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          {/* Mobile identity */}
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/api/pwa-icon/admin-icon-192.png" alt="ShuleHQ Admin" className="h-16 w-16 rounded-2xl shadow-md" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-dark-navy">
                Shule<span className="text-[#f59e0b]">HQ</span> Admin
              </h1>
              <p className="mt-1 text-sm text-muted-text">Operator control plane</p>
            </div>
          </div>

          <div className="mb-7">
            <div className="mb-4 inline-flex items-center gap-2 rounded-lg bg-slate-900/5 px-3 py-1.5 text-xs font-semibold text-slate-700">
              <KeyRound className="size-3.5 text-[#b45309]" /> Platform operator sign-in
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-dark-navy">Sign in to continue</h2>
            <p className="mt-1.5 text-sm text-muted-text">
              Authenticate as the platform operator. Tenant selection isn&apos;t used on this host.
            </p>
          </div>

          {serverError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="saas-email">Email</Label>
              <Input
                id="saas-email"
                placeholder="operator@shulehq.co.ke"
                autoComplete="email"
                {...register("email", {
                  required: "Email is required",
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email" },
                })}
              />
              {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="saas-password">Password</Label>
              <PasswordInput
                id="saas-password"
                placeholder="Enter your password"
                autoComplete="current-password"
                {...register("password", {
                  required: "Password is required",
                  minLength: { value: 6, message: "Minimum 6 characters" },
                })}
              />
              {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-slate-900 py-6 text-base font-semibold text-white transition-colors hover:bg-slate-800"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-text/70">
            © {new Date().getFullYear()} ShuleHQ · Operator console
          </p>
        </div>
      </main>
    </div>
  );
}
