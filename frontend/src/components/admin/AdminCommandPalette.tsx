"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, Rocket, Building2, CreditCard, HandCoins, CalendarDays,
  Headset, ShieldCheck, Layers, ScrollText, DatabaseBackup, Megaphone,
  MessageSquare, Search, CornerDownLeft, type LucideIcon,
} from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { saasNav } from "@/components/layout/nav-config";
import { apiFetch } from "@/lib/api";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Rocket, Building2, CreditCard, HandCoins, CalendarDays,
  Headset, ShieldCheck, Layers, ScrollText, DatabaseBackup, Megaphone, MessageSquare,
};

type TenantHit = { id: string; name: string; slug: string };

export function AdminCommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tenants, setTenants] = useState<TenantHit[]>([]);

  useEffect(() => { if (open) { setQ(""); setTenants([]); } }, [open]);

  // Debounced tenant lookup.
  useEffect(() => {
    const term = q.trim();
    if (!term) { setTenants([]); return; }
    const id = setTimeout(() => {
      apiFetch<TenantHit[]>(`/admin/tenants?q=${encodeURIComponent(term)}`, { method: "GET", tenantRequired: false })
        .then((r) => setTenants((Array.isArray(r) ? r : []).slice(0, 6)))
        .catch(() => setTenants([]));
    }, 220);
    return () => clearTimeout(id);
  }, [q]);

  const navMatches = useMemo(
    () => saasNav.filter((n) => !q.trim() || n.label.toLowerCase().includes(q.trim().toLowerCase())),
    [q]
  );

  function go(href: string) { onOpenChange(false); router.push(href); }

  const firstHref = navMatches[0]?.href;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-theme gap-0 overflow-hidden p-0 sm:max-w-xl [&>button]:hidden">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-[var(--admin-border)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--admin-muted)]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && firstHref) go(firstHref); }}
            placeholder="Jump to a screen, or search tenants…"
            className="h-12 w-full bg-transparent text-sm text-[var(--admin-ink)] outline-none placeholder:text-[var(--admin-muted)]"
          />
          <kbd className="hidden shrink-0 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--admin-muted)] sm:inline">Esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {navMatches.length > 0 && (
            <>
              <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--admin-muted)]">Navigate</div>
              {navMatches.map((n) => {
                const Icon = (n.icon && ICONS[n.icon]) || LayoutDashboard;
                return (
                  <button key={n.href} onClick={() => go(n.href)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[var(--admin-ink)] transition-colors hover:bg-[var(--admin-surface-2)]">
                    <Icon className="h-4 w-4 shrink-0 text-[var(--admin-muted)]" />
                    <span className="flex-1">{n.label}</span>
                  </button>
                );
              })}
            </>
          )}

          {tenants.length > 0 && (
            <>
              <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--admin-muted)]">Tenants</div>
              {tenants.map((t) => (
                <button key={t.id} onClick={() => go("/saas/tenants")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[var(--admin-ink)] transition-colors hover:bg-[var(--admin-surface-2)]">
                  <Building2 className="h-4 w-4 shrink-0 text-[var(--admin-muted)]" />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="font-mono text-xs text-[var(--admin-muted)]">{t.slug}</span>
                </button>
              ))}
            </>
          )}

          {q.trim() && navMatches.length === 0 && tenants.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-[var(--admin-muted)]">No matches for “{q.trim()}”.</div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--admin-border)] px-4 py-2 text-[11px] text-[var(--admin-muted)]">
          <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> open</span>
          <span>·</span>
          <span>type to filter screens & tenants</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
