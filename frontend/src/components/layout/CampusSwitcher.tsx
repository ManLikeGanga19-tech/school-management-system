"use client";

/**
 * CampusSwitcher — lets a multi-campus user move between the campuses of
 * their tenant group without re-logging in. Renders nothing for users who
 * belong to a single campus (or no group).
 */
import { useEffect, useRef, useState } from "react";
import { Building2, ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

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
      // BFF route: rewrites the SSR tenant cookies (sms_tenant_slug/id + access)
      // so the server-rendered dashboard shows the new campus after reload.
      const res = await fetch("/api/auth/switch-campus", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: c.tenant_id, tenant_slug: c.slug }),
      });
      if (!res.ok) throw new Error("switch failed");
      // The BFF has already set the new campus's session cookies — just reload.
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
        className="flex w-full items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-sm transition hover:bg-white/10"
      >
        <Building2 className="h-4 w-4 shrink-0 text-[var(--tenant-accent)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-white">
          {current?.name ?? "Select campus"}
        </span>
        {switching ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/50" />
        ) : (
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-white/50" />
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
