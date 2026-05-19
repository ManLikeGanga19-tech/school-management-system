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

// Persist the last known state so a hard page reload renders the gated nav
// correctly on the first paint — no flash of locked modules before the
// /tenants/subscription fetch resolves.
const STORAGE_KEY = "sms_subscription_state";

function readStored(): SubscriptionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStored(s: SubscriptionState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

async function fetchSubscription(): Promise<SubscriptionState | null> {
  if (cache) return cache;
  if (!inflight) {
    inflight = api
      .get<Partial<SubscriptionState>>("/tenants/subscription", { tenantRequired: true })
      .then((d) => {
        cache = normalize(d);
        writeStored(cache);
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
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function useSubscription() {
  // Boot from the in-memory cache only. On a fresh page load `cache` is null on
  // both the server and the first client render, so the hydration HTML matches
  // (no React #418). The persisted sessionStorage snapshot is read in the
  // effect below — after hydration — and on later client-side navigations the
  // in-memory cache is already populated, so gating still never flashes.
  const [sub, setSub] = useState<SubscriptionState | null>(() => cache);
  const [status, setStatus] = useState<LoadStatus>(() => (cache ? "ready" : "loading"));

  useEffect(() => {
    let active = true;
    // Safe post-hydration: seed instantly from the persisted snapshot, then
    // always refresh in the background so the live state wins.
    const stored = cache ?? readStored();
    if (stored && active) {
      setSub((s) => s ?? stored);
      setStatus("ready");
    }
    void fetchSubscription().then((d) => {
      if (!active) return;
      if (d) {
        setSub(d);
        setStatus("ready");
      } else if (!stored) {
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
