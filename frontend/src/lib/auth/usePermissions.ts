"use client";

/**
 * usePermissions — the current user's RBAC permissions for UI gating.
 *
 * Gates UI off the user's *actual* permissions (from GET /tenants/whoami),
 * not a hardcoded role, so a button only renders when the backend will
 * accept the action. The whoami result is cached at module scope, so the
 * fetch happens once per session no matter how many components use it.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type RbacContext = {
  roles: string[];
  permissions: string[];
};

const EMPTY: RbacContext = { roles: [], permissions: [] };

let cache: RbacContext | null = null;
let inflight: Promise<RbacContext> | null = null;

async function fetchRbac(): Promise<RbacContext> {
  if (cache) return cache;
  if (!inflight) {
    inflight = api
      .get<Partial<RbacContext>>("/tenants/whoami", { tenantRequired: true })
      .then((d) => {
        cache = {
          roles: Array.isArray(d?.roles) ? d!.roles : [],
          permissions: Array.isArray(d?.permissions) ? d!.permissions : [],
        };
        return cache;
      })
      .catch(() => {
        // Don't poison the cache on failure — allow a later retry.
        inflight = null;
        return EMPTY;
      });
  }
  return inflight;
}

/** Clear the cached whoami (call on logout / tenant switch). */
export function resetPermissionsCache(): void {
  cache = null;
  inflight = null;
}

export function usePermissions() {
  const [ctx, setCtx] = useState<RbacContext>(cache ?? EMPTY);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    if (cache) {
      setCtx(cache);
      setLoading(false);
      return;
    }
    let active = true;
    void fetchRbac().then((d) => {
      if (active) {
        setCtx(d);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return {
    roles: ctx.roles,
    permissions: ctx.permissions,
    loading,
    /** True when the current user holds the given permission code. */
    has: (code: string) => ctx.permissions.includes(code),
    /** True when the user holds at least one of the given codes. */
    hasAny: (...codes: string[]) => codes.some((c) => ctx.permissions.includes(c)),
  };
}
