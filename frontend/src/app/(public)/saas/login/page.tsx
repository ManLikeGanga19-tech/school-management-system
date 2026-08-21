"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { LockKeyhole, ShieldCheck, Building2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { ShuleHQLogo } from "@/components/brand/ShuleHQLogo";

import { login } from "@/lib/auth/auth";

type FormValues = { email: string; password: string };

const GOLD = "#f59e0b";

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
    <div className="flex min-h-screen bg-slate-950">
      {/* LEFT — operator brand panel (desktop) */}
      <aside
        className="relative hidden w-[42%] flex-col justify-between overflow-hidden p-12 text-white lg:flex xl:w-[45%]"
        style={{ background: "linear-gradient(160deg, #1e293b 0%, #0f172a 100%)" }}
      >
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full" style={{ background: `${GOLD}22`, filter: "blur(48px)" }} />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-black/40 blur-3xl" />

        <div className="relative z-10 flex items-center gap-2">
          <ShuleHQLogo theme="dark" size={28} />
        </div>

        <div className="relative z-10">
          <span
            className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
            style={{ borderColor: `${GOLD}55`, color: GOLD, backgroundColor: `${GOLD}14` }}
          >
            <LockKeyhole className="size-3.5" /> Operator Control Plane
          </span>
          <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight xl:text-5xl">ShuleHQ Admin</h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-white/60">
            Platform administration, rollout oversight, billing controls and support operations — isolated on the admin host.
          </p>

          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 max-w-md">
            <Building2 className="mt-0.5 size-4" style={{ color: GOLD }} />
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Admin host</p>
              <p className="mt-1 text-sm font-medium text-white">{adminHost}</p>
              <p className="mt-2 text-xs leading-5 text-white/50">
                Schools never sign in here — each uses its own mapped workspace such as{" "}
                <span className="font-medium text-white/80">novel-school.shulehq.co.ke</span>.
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs font-medium text-white/40">
          <span>Powered by ShuleHQ</span>
          <span className="h-1 w-1 rounded-full bg-white/30" />
          <span>Secure operator access</span>
        </div>
      </aside>

      {/* RIGHT — sign-in form */}
      <main className="flex w-full flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          {/* Compact identity — mobile only */}
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: `${GOLD}1a` }}>
              <ShieldCheck className="size-7" style={{ color: GOLD }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">ShuleHQ Admin</h1>
              <p className="mt-1 text-sm text-white/50">Operator control plane</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl backdrop-blur sm:p-8">
            <div className="mb-6">
              <span
                className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
                style={{ borderColor: `${GOLD}55`, color: GOLD, backgroundColor: `${GOLD}14` }}
              >
                <ShieldCheck className="size-3.5" /> Secure SaaS access
              </span>
              <h2 className="text-2xl font-bold tracking-tight text-white">Operator sign-in</h2>
              <p className="mt-1.5 text-sm text-white/50">
                Authenticate as the platform operator. Tenant selection is not used on this host.
              </p>
            </div>

            {serverError && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="saas-email" className="text-white/80">Email</Label>
                <Input
                  id="saas-email"
                  placeholder="operator@shulehq.co.ke"
                  autoComplete="email"
                  className="border-white/15 bg-white/5 text-white placeholder:text-white/30"
                  {...register("email", {
                    required: "Email is required",
                    pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email" },
                  })}
                />
                {errors.email && <p className="text-xs text-red-300">{errors.email.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="saas-password" className="text-white/80">Password</Label>
                <PasswordInput
                  id="saas-password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="border-white/15 bg-white/5 text-white placeholder:text-white/30"
                  {...register("password", {
                    required: "Password is required",
                    minLength: { value: 6, message: "Minimum 6 characters" },
                  })}
                />
                {errors.password && <p className="text-xs text-red-300">{errors.password.message}</p>}
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-6 text-base font-semibold text-slate-950 transition-opacity hover:opacity-90"
                style={{ backgroundColor: GOLD }}
              >
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </div>

          <p className="mt-8 text-center text-xs text-white/30">
            © {new Date().getFullYear()} ShuleHQ · Operator console
          </p>
        </div>
      </main>
    </div>
  );
}
