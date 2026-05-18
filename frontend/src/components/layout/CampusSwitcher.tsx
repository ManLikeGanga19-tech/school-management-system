"use client";

/**
 * CampusSwitcher — lets a multi-campus user move between the campuses of
 * their tenant group without re-logging in. Renders nothing for users who
 * belong to a single campus (or no group).
 */
import { useEffect, useRef, useState } from "react";
import { Building2, ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { storage, keys } from "@/lib/storage";

type Campus = {
  tenant_id: string;
  name: string;
  slug: string;
  is_current: boolean;
};

export function CampusSwitcher() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    apiFetch<Campus[]>("/auth/my-campuses", { tenantRequired: true } as never)
      .then((d) => {
        if (active) setCampuses(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (active) setCampuses([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Only meaningful when the user belongs to 2+ campuses.
  if (campuses.length < 2) return null;

  const current = campuses.find((c) => c.is_current);

  async function switchTo(c: Campus) {
    if (c.is_current || switching) return;
    setSwitching(true);
    try {
      const res = await apiFetch<{ access_token?: string }>("/auth/switch-campus", {
        method: "POST",
        tenantRequired: true,
        body: JSON.stringify({ tenant_id: c.tenant_id }),
        headers: { "Content-Type": "application/json" },
      } as never);
      // Point the client at the new campus before reloading so the first
      // requests after reload already carry the right tenant context.
      if (res?.access_token) storage.set(keys.accessToken, res.access_token);
      storage.set(keys.tenantId, c.tenant_id);
      storage.set(keys.tenantSlug, c.slug);
      window.location.assign("/");
    } catch {
      setSwitching(false);
    }
  }

  return (
    <div ref={ref} className="relative px-4 pb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-[#e1d4c0] bg-white px-3 py-2 text-left text-sm transition hover:bg-[#f5ece1]"
      >
        <Building2 className="h-4 w-4 shrink-0 text-[#7c4b24]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[#173f49]">
          {current?.name ?? "Select campus"}
        </span>
        {switching ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
        ) : (
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
        )}
      </button>

      {open && !switching && (
        <div className="absolute left-4 right-4 z-50 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Switch campus
          </div>
          {campuses.map((c) => (
            <button
              key={c.tenant_id}
              type="button"
              onClick={() => void switchTo(c)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1 truncate text-slate-700">{c.name}</span>
              {c.is_current && <Check className="h-4 w-4 shrink-0 text-teal-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
