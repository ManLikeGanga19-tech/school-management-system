"use client";

import { ShuleHQLogo } from "@/components/brand/ShuleHQLogo";

/**
 * Branded, enterprise-grade session gate shown while auth is verified — replaces
 * the bare "Checking session..." text. Mode-aware: the operator (saas) build
 * gets the dark-slate + gold admin identity; a tenant gets the light ShuleHQ mark.
 */
export function AuthLoadingScreen({ mode }: { mode: "saas" | "tenant" }) {
  const isSaas = mode === "saas";

  return (
    <div
      className={`flex min-h-screen flex-col items-center justify-center gap-8 px-6 ${
        isSaas ? "bg-[#0f172a]" : "bg-page-bg"
      }`}
    >
      {/* Brand mark */}
      {isSaas ? (
        <div className="flex flex-col items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/pwa-icon/admin-icon-192.png" alt="ShuleHQ Admin" className="h-14 w-14 rounded-2xl shadow-lg" />
          <span className="text-2xl font-bold tracking-tight text-white">
            Shule<span className="text-[#d4af37]">HQ</span>
            <span className="ml-2 align-middle text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Admin</span>
          </span>
        </div>
      ) : (
        <ShuleHQLogo size={48} />
      )}

      {/* Spinner + label */}
      <div className="flex items-center gap-3">
        <span
          className={`h-5 w-5 animate-spin rounded-full border-[3px] ${
            isSaas ? "border-white/15 border-t-[#d4af37]" : "border-brand-border border-t-brand-primary"
          }`}
          aria-hidden
        />
        <span className={`text-sm font-medium ${isSaas ? "text-white/60" : "text-muted-text"}`}>
          {isSaas ? "Securing your session…" : "Loading your workspace…"}
        </span>
      </div>

      <span className="sr-only" role="status">Verifying your session</span>

      <p className={`absolute bottom-8 text-xs font-medium ${isSaas ? "text-white/30" : "text-muted-text/50"}`}>
        Powered by ShuleHQ
      </p>
    </div>
  );
}
