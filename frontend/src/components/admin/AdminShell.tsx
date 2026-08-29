"use client";

/**
 * AdminShell — v2 "Prestige Professional" shell for the Super-Admin console.
 *
 * UI/UX ONLY. It reuses the EXISTING nav links (saasNav), the same active-state
 * logic, and the same live badge endpoints as the old AppShell — nothing about
 * the backend, routes, or data wiring changes. Scoped under `.admin-theme` so
 * the tenant app and marketing site are completely unaffected.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Rocket, Building2, CreditCard, HandCoins, CalendarDays,
  Headset, ShieldCheck, Layers, ScrollText, DatabaseBackup, Megaphone,
  MessageSquare, Search, Bell, HelpCircle, PanelLeftClose, PanelLeft, Menu, X,
  LogOut, AlertTriangle, CheckCircle2, Keyboard, ChevronDown, Mail, type LucideIcon,
} from "lucide-react";

import { saasNav } from "@/components/layout/nav-config";
import type { AppNavItem } from "@/components/layout/AppShell";
import { apiFetch } from "@/lib/api";
import { logout, getCurrentUser } from "@/lib/auth/auth";
import { storage } from "@/lib/storage";
import { AdminCommandPalette } from "@/components/admin/AdminCommandPalette";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Rocket, Building2, CreditCard, HandCoins, CalendarDays,
  Headset, ShieldCheck, Layers, ScrollText, DatabaseBackup, Megaphone, MessageSquare,
};

type BadgeCounts = { saasRollout: number; saasSupport: number };
type MeUser = { user_id?: string; email?: string; full_name?: string; roles?: string[] };

function asObj(v: unknown): Record<string, any> | null {
  return v && typeof v === "object" ? (v as Record<string, any>) : null;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** "SUPER_ADMIN" → "Super Admin"; falls back to a sensible operator label. */
function formatRole(roles?: string[]): string {
  const code = roles?.find((r) => r && r.trim());
  if (!code) return "Operator";
  return code
    .trim()
    .toLowerCase()
    .split(/[_\s]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** Initials from a full name, falling back to the email, then "SA". */
function initialsOf(name?: string, email?: string): string {
  const n = (name || "").trim();
  if (n) {
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "SA";
  }
  const e = (email || "").trim();
  return e ? e[0].toUpperCase() : "SA";
}

export function AdminShell({
  title = "Super Admin",
  children,
  activeHref,
}: {
  title?: string;
  children: React.ReactNode;
  /** Optional explicit active route; falls back to the current pathname. */
  activeHref?: string;
}) {
  const currentPath = usePathname() || "";
  const pathname = activeHref || currentPath;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [badges, setBadges] = useState<BadgeCounts>({ saasRollout: 0, saasSupport: 0 });
  const [pastDue, setPastDue] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [me, setMe] = useState<MeUser | null>(null);

  // Real logged-in operator for the sidebar + top-bar identity.
  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((u) => { if (!cancelled) setMe(u as MeUser); })
      .catch(() => { /* RequireAuth already gates the session */ });
    return () => { cancelled = true; };
  }, []);

  // Cmd/Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    try {
      if (storage.get("admin_sidebar_collapsed") === "1") setCollapsed(true);
    } catch {}
  }, []);
  useEffect(() => {
    try { storage.set("admin_sidebar_collapsed", collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Live badge counts — same endpoints the old shell used.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let rollout = 0, support = 0;
      try {
        const raw = await apiFetch<unknown>("/admin/saas/rollout/requests?limit=1&offset=0", { method: "GET", tenantRequired: false });
        const c = asObj(asObj(raw)?.counts);
        rollout = Number(c?.new || 0) + Number(c?.contacting || 0) + Number(c?.scheduled || 0);
      } catch {}
      try {
        const raw = await apiFetch<unknown>("/support/admin/unread-count", { method: "GET", tenantRequired: false });
        support = Number(asObj(raw)?.unread_count || 0);
      } catch {}
      let due = 0;
      try {
        const raw = await apiFetch<unknown>("/admin/saas/metrics", { method: "GET", tenantRequired: false });
        due = Number(asObj(asObj(raw)?.subscriptions)?.past_due || 0);
      } catch {}
      if (!cancelled) {
        setBadges({
          saasRollout: Number.isFinite(rollout) && rollout > 0 ? Math.floor(rollout) : 0,
          saasSupport: Number.isFinite(support) && support > 0 ? Math.floor(support) : 0,
        });
        setPastDue(Number.isFinite(due) && due > 0 ? Math.floor(due) : 0);
      }
    })();
    return () => { cancelled = true; };
  }, [pathname]);

  const navItems = useMemo(() => saasNav, []);

  const displayName = me?.full_name?.trim() || "Super Admin";
  const displayEmail = me?.email?.trim() || "";
  const roleLabel = formatRole(me?.roles);
  const initials = initialsOf(me?.full_name, me?.email);

  const SidebarBody = ({ mobile = false }: { mobile?: boolean }) => (
    <>
      {/* Brand */}
      <div className={`flex items-center gap-3 px-4 ${collapsed && !mobile ? "justify-center" : ""} h-16 shrink-0 border-b border-white/[0.06]`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/pwa-icon/admin-icon-192.png" alt="ShuleHQ Admin" className="h-9 w-9 rounded-lg shrink-0" />
        {(!collapsed || mobile) && (
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight text-white">
              Shule<span className="text-[var(--admin-gold)]">HQ</span>
            </div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">Enterprise Admin</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navItems.map((item: AppNavItem) => {
            const Icon = (item.icon && ICONS[item.icon]) || LayoutDashboard;
            const active = isActive(pathname, item.href);
            const count = item.badgeKey ? badges[item.badgeKey as keyof BadgeCounts] || 0 : 0;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={collapsed && !mobile ? item.label : undefined}
                  className={[
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    collapsed && !mobile ? "justify-center" : "",
                    active
                      ? "bg-white/[0.06] font-semibold text-white"
                      : "font-medium text-white/60 hover:bg-white/[0.04] hover:text-white",
                  ].join(" ")}
                >
                  {active && <span className="absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r bg-[var(--admin-gold)]" style={{ width: 3 }} />}
                  <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-[var(--admin-gold)]" : ""}`} />
                  {(!collapsed || mobile) && <span className="flex-1 truncate">{item.label}</span>}
                  {count > 0 && (!collapsed || mobile) && (
                    <span className="ml-auto rounded-full bg-[var(--admin-gold)] px-1.5 py-0.5 text-[10px] font-bold text-[#3a2f00]">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                  {count > 0 && collapsed && !mobile && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--admin-gold)]" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Profile / logout */}
      <div className="shrink-0 border-t border-white/[0.06] p-3">
        <div
          className={`flex items-center gap-3 rounded-lg px-2 py-2 ${collapsed && !mobile ? "justify-center" : ""}`}
          title={collapsed && !mobile ? `${displayName}${displayEmail ? ` · ${displayEmail}` : ""}` : undefined}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--admin-gold)] text-xs font-bold text-[#3a2f00]">{initials}</div>
          {(!collapsed || mobile) && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold text-white">{displayName}</div>
              <div className="truncate text-xs text-white/40">{displayEmail || roleLabel}</div>
            </div>
          )}
          {(!collapsed || mobile) && (
            <button onClick={() => void logout()} title="Log out" className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="admin-theme min-h-screen font-[family-name:var(--font-admin-sans)]">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col bg-[var(--admin-primary)] transition-[width] duration-200 lg:flex ${collapsed ? "w-20" : "w-64"}`}
      >
        <SidebarBody />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-[var(--admin-primary)]">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
            <SidebarBody mobile />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className={`flex min-h-screen flex-col transition-[padding] duration-200 ${collapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        {/* Top bar */}
        <header aria-label={`${title} console`} className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-surface)]/85 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-2 text-[var(--admin-muted)] hover:bg-[var(--admin-surface-2)] lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="hidden rounded-md p-2 text-[var(--admin-muted)] hover:bg-[var(--admin-surface-2)] lg:inline-flex"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>

          {/* Command palette trigger */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden max-w-md flex-1 items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-left text-sm text-[var(--admin-muted)] transition-colors hover:border-[var(--admin-gold)] hover:bg-white sm:flex"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">Search screens &amp; tenants…</span>
            <kbd className="rounded border border-[var(--admin-border)] bg-white px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            {/* Notifications */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="relative rounded-md p-2 text-[var(--admin-muted)] hover:bg-[var(--admin-surface-2)]" title="Notifications">
                  <Bell className="h-5 w-5" />
                  {badges.saasRollout + badges.saasSupport + pastDue > 0 && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--admin-error)]" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="admin-theme w-72">
                <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {badges.saasRollout + badges.saasSupport + pastDue === 0 ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-[var(--admin-muted)]">
                    <CheckCircle2 className="h-4 w-4 text-[var(--admin-success)]" /> All clear — nothing needs attention.
                  </div>
                ) : (
                  <>
                    {pastDue > 0 && (
                      <DropdownMenuItem asChild>
                        <Link href="/saas/subscriptions/billing" className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--admin-error)]" />
                          <span><b>{pastDue}</b> subscription{pastDue !== 1 ? "s" : ""} past due</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {badges.saasRollout > 0 && (
                      <DropdownMenuItem asChild>
                        <Link href="/saas/rollout" className="flex items-start gap-2">
                          <Rocket className="mt-0.5 h-4 w-4 text-[var(--admin-gold)]" />
                          <span><b>{badges.saasRollout}</b> new prospect lead{badges.saasRollout !== 1 ? "s" : ""}</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {badges.saasSupport > 0 && (
                      <DropdownMenuItem asChild>
                        <Link href="/saas/support" className="flex items-start gap-2">
                          <Headset className="mt-0.5 h-4 w-4 text-[var(--admin-slate)]" />
                          <span><b>{badges.saasSupport}</b> unread support message{badges.saasSupport !== 1 ? "s" : ""}</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Help */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md p-2 text-[var(--admin-muted)] hover:bg-[var(--admin-surface-2)]" title="Help">
                  <HelpCircle className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="admin-theme w-56">
                <DropdownMenuLabel>Help &amp; resources</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                  <Keyboard className="h-4 w-4" /> Command palette <span className="ml-auto text-xs text-[var(--admin-muted)]">⌘K</span>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/saas/changelog"><Megaphone className="h-4 w-4" /> What&apos;s new</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/saas/support"><Headset className="h-4 w-4" /> Support inbox</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 flex items-center gap-2 border-l border-[var(--admin-border)] py-1 pl-3 text-left hover:opacity-90">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--admin-primary)] text-xs font-bold text-[var(--admin-gold)]">{initials}</div>
                  <div className="hidden leading-tight sm:block">
                    <div className="max-w-[10rem] truncate text-sm font-semibold text-[var(--admin-ink)]">{displayName}</div>
                    <div className="text-[11px] font-medium text-[var(--admin-muted)]">{roleLabel}</div>
                  </div>
                  <ChevronDown className="hidden h-4 w-4 text-[var(--admin-muted)] sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="admin-theme w-64">
                <div className="flex items-center gap-3 px-2 py-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--admin-primary)] text-sm font-bold text-[var(--admin-gold)]">{initials}</div>
                  <div className="min-w-0 leading-tight">
                    <div className="truncate text-sm font-semibold text-[var(--admin-ink)]">{displayName}</div>
                    {displayEmail && (
                      <div className="flex items-center gap-1 text-xs text-[var(--admin-muted)]">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{displayEmail}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="px-2 pb-1">
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--admin-gold-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--admin-slate)]">
                    <ShieldCheck className="h-3 w-3" /> {roleLabel}
                  </span>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/saas/rbac"><ShieldCheck className="h-4 w-4" /> Roles &amp; access</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void logout()} className="text-[var(--admin-error)] focus:text-[var(--admin-error)]">
                  <LogOut className="h-4 w-4" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      <AdminCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
