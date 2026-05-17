"use client";

/**
 * useSubscription — the tenant's subscription state for module gating + the
 * renewal banner. Mirrors usePermissions: one module-cached fetch per session.
 *
 * Fail-open: until the state is definitively loaded (or if the fetch fails),
 * has() returns true and the renewal banner stays hidden — a subscription
 * check must never blank out the UI.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type SubscriptionLifecycle = "active" | "grace" | "locked";

export type SubscriptionState = {
  state: SubscriptionLifecycle;
  plan_code: string | null;
  plan_name: string | null;
  modules: string[];
  status: string | null;
  period_end: string | null;
  grace_until: string | null;
  grace_days: number;
};

type LoadStatus = "loading" | "ready" | "error";

let cache: SubscriptionState | null = null;
let inflight: Promise<SubscriptionState | null> | null = null;

function normalize(d: Partial<SubscriptionState> | null | undefined): SubscriptionState {
  return {
    state: (d?.state as SubscriptionLifecycle) || "active",
    plan_code: d?.plan_code ?? null,
    plan_name: d?.plan_name ?? null,
    modules: Array.isArray(d?.modules) ? d!.modules : [],
    status: d?.status ?? null,
    period_end: d?.period_end ?? null,
    grace_until: d?.grace_until ?? null,
    grace_days: typeof d?.grace_days === "number" ? d!.grace_days : 14,
  };
}

async function fetchSubscription(): Promise<SubscriptionState | null> {
  if (cache) return cache;
  if (!inflight) {
    inflight = api
      .get<Partial<SubscriptionState>>("/tenants/subscription", { tenantRequired: true })
      .then((d) => {
        cache = normalize(d);
        return cache;
      })
      .catch(() => {
        inflight = null; // allow retry
        return null;
      });
  }
  return inflight;
}

/** Clear the cached subscription (call on logout / tenant switch). */
export function resetSubscriptionCache(): void {
  cache = null;
  inflight = null;
}

export function useSubscription() {
  const [sub, setSub] = useState<SubscriptionState | null>(cache);
  const [status, setStatus] = useState<LoadStatus>(cache ? "ready" : "loading");

  useEffect(() => {
    if (cache) {
      setSub(cache);
      setStatus("ready");
      return;
    }
    let active = true;
    void fetchSubscription().then((d) => {
      if (!active) return;
      if (d) {
        setSub(d);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const ready = status === "ready" && sub !== null;

  return {
    subscription: sub,
    status,
    ready,
    /** Module visibility — fail-open until a definitive state is loaded. */
    has: (moduleCode: string) =>
      !ready ? true : sub!.modules.includes(moduleCode),
    /** True only once we have a confirmed grace/locked state. */
    isGrace: ready && sub!.state === "grace",
    isLocked: ready && sub!.state === "locked",
  };
}
