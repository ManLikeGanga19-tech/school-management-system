"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  Bell,
  Building2,
  BookOpenText,
  BriefcaseBusiness,
  CalendarDays,
  Headset,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  FileSpreadsheet,
  FileText,
  HandCoins,
  IdCard,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Layers,
  List,
  Package,
  Presentation,
  Receipt,
  Rocket,
  School,
  ScrollText,
  Settings2,
  ShieldCheck,
  LogOut,
  Menu,
  UserCog,
  UserRoundPlus,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { api, apiFetchRaw } from "@/lib/api";
import { logout as authLogout } from "@/lib/auth/auth";
import { TENANT_BRANDING_UPDATED_EVENT } from "@/lib/tenant-branding";
import { FloatingSupportWidget } from "@/components/support/FloatingSupportWidget";

type AppNavLink = {
  href: string;
  label: string;
  icon?: string;
  showUnreadBadge?: boolean;
};

export type AppNavItem = AppNavLink & {
  children?: AppNavLink[];
};

const NAV_ICON_REGISTRY: Record<string, LucideIcon> = {
  BadgeDollarSign,
  Bell,
  Building2,
  BookOpenText,
  BriefcaseBusiness,
  CalendarDays,
  Headset,
  ClipboardCheck,
  CreditCard,
  FileSpreadsheet,
  FileText,
  HandCoins,
  IdCard,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Layers,
  List,
  Package,
  Presentation,
  Receipt,
  Rocket,
  School,
  ScrollText,
  Settings2,
  ShieldCheck,
  UserCog,
  UserRoundPlus,
  Users,
  WalletCards,
};

type NotificationPreview = {
  id: string;
  title: string;
  message: string;
  unread: boolean;
};

type CurrentUserPreview = {
  email: string;
  fullName: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCurrentUserPreview(value: unknown): CurrentUserPreview | null {
  const root = asObject(value);
  if (!root) return null;

  const user = asObject(root.user) || root;
  const email = asString(user.email);
  const fullName = asString(user.full_name) || asString(user.fullName);

  if (!email && !fullName) return null;
  return {
    email: email || "",
    fullName: fullName || "",
  };
}

function resolveSettingsHref(path: string): string {
  const normalized = normalizePath(path || "/");
  if (normalized.startsWith("/tenant/director")) return "/tenant/director/settings";
  if (normalized.startsWith("/tenant/secretary")) return "/tenant/secretary/settings";
  if (normalized.startsWith("/tenant/principal")) return "/tenant/principal/settings";
  if (normalized.startsWith("/saas")) return "/saas/tenants";
  return "/login";
}

function normalizeNotificationPreviews(value: unknown): NotificationPreview[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): NotificationPreview | null => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      const title = asString(row.title);
      const message = asString(row.message);
      if (!id || !title) return null;
      return {
        id,
        title,
        message,
        unread: row.unread === undefined ? true : Boolean(row.unread),
      };
    })
    .filter((row): row is NotificationPreview => Boolean(row));
}

function normalizePath(path: string) {
  if (!path) return "/";
  const clean = path.replace(/\/+$/, "");
  return clean || "/";
}

function parseHref(href: string) {
  try {
    const url = new URL(href, "https://nav.local");
    return {
      path: normalizePath(url.pathname),
      full: `${normalizePath(url.pathname)}${url.search}`,
    };
  } catch {
    return { path: normalizePath(href), full: normalizePath(href) };
  }
}

export function AppShell({
  title,
  children,
  nav,
  activeHref,
}: {
  title: string;
  children: React.ReactNode;
  nav: AppNavItem[];
  activeHref?: string;
}) {
  const pathname = usePathname();
  const [browserSearch, setBrowserSearch] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setBrowserSearch(window.location.search || "");
  }, [pathname]);

  const currentHref = useMemo(() => {
    if (activeHref && activeHref.trim()) return activeHref;
    return `${normalizePath(pathname || "/")}${browserSearch}`;
  }, [activeHref, pathname, browserSearch]);

  const active = useMemo(() => parseHref(currentHref), [currentHref]);

  const activeModuleKey = useMemo(() => {
    const activeByChild = nav.find((item) =>
      (item.children || []).some((child) => parseHref(child.href).full === active.full)
    );
    if (activeByChild) return parseHref(activeByChild.href).path;

    const activeByPath = nav.find((item) => parseHref(item.href).path === active.path);
    return activeByPath ? parseHref(activeByPath.href).path : null;
  }, [active.full, active.path, nav]);

  const [expandedModuleKey, setExpandedModuleKey] = useState<string | null>(activeModuleKey);
  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountMenuOpenDesktop, setAccountMenuOpenDesktop] = useState(false);
  const [accountMenuOpenMobile, setAccountMenuOpenMobile] = useState(false);
  const [sidebarUserEmail, setSidebarUserEmail] = useState("Tenant user");
  const [sidebarUserName, setSidebarUserName] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarBadgeUrl, setSidebarBadgeUrl] = useState<string | null>(null);
  const seenUnreadIdsRef = useRef<Set<string>>(new Set());
  const initializedRealtimeRef = useRef(false);
  const lastNotificationSoundAtRef = useRef(0);
  const settingsHref = useMemo(() => resolveSettingsHref(pathname || "/"), [pathname]);
  const supportWidgetEnabled = useMemo(() => {
    const current = normalizePath(pathname || "/");
    return current.startsWith("/tenant/director") || current.startsWith("/tenant/secretary");
  }, [pathname]);
  const supportWidgetPageHref = useMemo(() => {
    const current = normalizePath(pathname || "/");
    if (current.startsWith("/tenant/director")) return "/tenant/director/contact-admin";
    if (current.startsWith("/tenant/secretary")) return "/tenant/secretary/contact-admin";
    return "/tenant/director/contact-admin";
  }, [pathname]);

  const playNotificationPop = useCallback(() => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    if (now - lastNotificationSoundAtRef.current < 1400) return;
    lastNotificationSoundAtRef.current = now;
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(920, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(640, audioContext.currentTime + 0.15);
      gain.gain.setValueAtTime(0.001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.045, audioContext.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
      window.setTimeout(() => {
        void audioContext.close();
      }, 260);
    } catch {
      // Ignore browser autoplay or audio-context restrictions.
    }
  }, []);

  useEffect(() => {
    setExpandedModuleKey(activeModuleKey);
  }, [activeModuleKey]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [currentHref]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadSidebarUser() {
      const path = pathname || "/";

      if (path.startsWith("/tenant/")) {
        if (!cancelled) {
          setSidebarUserEmail("Tenant user");
          setSidebarUserName("");
        }
        try {
          const raw = await api.get<unknown>("/auth/me", {
            tenantRequired: true,
            noRedirect: true,
          });
          const parsed = normalizeCurrentUserPreview(raw);
          if (!cancelled && parsed) {
            setSidebarUserEmail(parsed.email || "Tenant user");
            setSidebarUserName(parsed.fullName || "");
          }
        } catch {
          // Keep fallback labels.
        }
        return;
      }

      if (!cancelled && path.startsWith("/saas")) {
        setSidebarUserEmail("Super Admin");
        setSidebarUserName("");
      }
    }

    void loadSidebarUser();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await authLogout();
    } catch {
      // Best effort logout; redirect anyway.
    } finally {
      setLoggingOut(false);
      window.location.href = "/login";
    }
  }, [loggingOut]);

  const revokeObjectUrl = useCallback((value: string | null) => {
    if (!value || !value.startsWith("blob:")) return;
    URL.revokeObjectURL(value);
  }, []);

  const replaceSidebarBadgeUrl = useCallback(
    (next: string | null) => {
      setSidebarBadgeUrl((prev) => {
        if (prev && prev !== next) revokeObjectUrl(prev);
        return next;
      });
    },
    [revokeObjectUrl]
  );

  const loadSidebarBadge = useCallback(async () => {
    const path = pathname || "/";
    if (!path.startsWith("/tenant/")) {
      replaceSidebarBadgeUrl(null);
      return;
    }

    try {
      const response = await apiFetchRaw("/tenants/settings/badge", {
        method: "GET",
        tenantRequired: true,
        noRedirect: true,
      });
      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        replaceSidebarBadgeUrl(null);
        return;
      }
      replaceSidebarBadgeUrl(URL.createObjectURL(blob));
    } catch {
      replaceSidebarBadgeUrl(null);
    }
  }, [pathname, replaceSidebarBadgeUrl]);

  useEffect(() => {
    void loadSidebarBadge();
  }, [loadSidebarBadge]);

  useEffect(() => {
    const handleBrandingUpdated = () => {
      void loadSidebarBadge();
    };
    window.addEventListener(TENANT_BRANDING_UPDATED_EVENT, handleBrandingUpdated as EventListener);
    return () => {
      window.removeEventListener(TENANT_BRANDING_UPDATED_EVENT, handleBrandingUpdated as EventListener);
    };
  }, [loadSidebarBadge]);

  useEffect(() => {
    return () => {
      revokeObjectUrl(sidebarBadgeUrl);
    };
  }, [sidebarBadgeUrl, revokeObjectUrl]);

  useEffect(() => {
    const refreshPath =
      (pathname || "").startsWith("/saas") ? "/api/auth/saas/refresh" : "/api/auth/refresh";

    let cancelled = false;
    async function keepAlive() {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        await fetch(refreshPath, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
        });
      } catch {
        // Best-effort keep-alive: ignore transient network errors.
      }
    }

    const timer = window.setInterval(() => {
      void keepAlive();
    }, 8 * 60 * 1000);

    const onFocus = () => {
      void keepAlive();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    void keepAlive();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pathname]);

  const shouldLoadUnreadCount = useMemo(
    () =>
      nav.some((item) => {
        if (item.showUnreadBadge) return true;
        return (item.children || []).some((child) => child.showUnreadBadge);
      }),
    [nav]
  );

  useEffect(() => {
    if (!shouldLoadUnreadCount) {
      setUnreadCount(0);
      seenUnreadIdsRef.current = new Set();
      initializedRealtimeRef.current = false;
      return;
    }

    let cancelled = false;
    async function pollNotifications() {
      try {
        const [countRaw, notificationsRaw] = await Promise.all([
          api.get<unknown>("/tenants/notifications/unread-count", {
            tenantRequired: true,
            noRedirect: true,
          }),
          api.get<unknown>("/tenants/notifications?limit=20&offset=0", {
            tenantRequired: true,
            noRedirect: true,
          }),
        ]);

        const payload = asObject(countRaw) || {};
        const parsed = Number(payload.unread_count);
        const nextUnreadCount = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
        const unreadNotifications = normalizeNotificationPreviews(notificationsRaw).filter(
          (row) => row.unread
        );
        const currentUnreadIds = new Set(unreadNotifications.map((row) => row.id));

        if (!initializedRealtimeRef.current) {
          initializedRealtimeRef.current = true;
          seenUnreadIdsRef.current = currentUnreadIds;
        } else {
          const newUnread = unreadNotifications.filter(
            (row) => !seenUnreadIdsRef.current.has(row.id)
          );
          if (newUnread.length > 0) {
            playNotificationPop();
            if (newUnread.length === 1) {
              const item = newUnread[0];
              toast.info(item.title, {
                description: item.message || "A new tenant notification is available.",
              });
            } else {
              toast.info(`${newUnread.length} new notifications`, {
                description: newUnread[0]?.title || "Open Notifications to review details.",
              });
            }
          }
          seenUnreadIdsRef.current = currentUnreadIds;
        }

        if (!cancelled) {
          setUnreadCount(nextUnreadCount);
        }
      } catch {
        if (!cancelled) setUnreadCount(0);
      }
    }

    void pollNotifications();
    const timer = window.setInterval(() => {
      void pollNotifications();
    }, 8_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [playNotificationPop, shouldLoadUnreadCount]);

  const isPathActive  = (href: string) => parseHref(href).path === active.path;
  const isExactActive = (href: string) => parseHref(href).full === active.full;
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  const accountLabel = sidebarUserName || "Signed in user";

  function renderSidebarFooter(options?: { mobile?: boolean }) {
    const mobile = Boolean(options?.mobile);
    const accountMenuOpen = mobile ? accountMenuOpenMobile : accountMenuOpenDesktop;
    const setAccountMenuOpen = mobile ? setAccountMenuOpenMobile : setAccountMenuOpenDesktop;
    return (
      <div
        className={cn("border-t border-blue-100 p-3", !mobile && "pt-2")}
      >
        <DropdownMenu open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-auto w-full items-center justify-between px-3 py-2">
              <span className="min-w-0 text-left">
                <span className="block text-[10px] uppercase tracking-wide text-slate-500">
                  Account
                </span>
                <span className="block truncate text-sm font-medium text-slate-800">
                  {sidebarUserEmail}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-slate-500 transition-transform",
                  accountMenuOpen ? "rotate-0" : "rotate-180"
                )}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            className="w-64"
          >
            <DropdownMenuLabel className="truncate">{accountLabel}</DropdownMenuLabel>
            <div className="px-2 pb-1 text-xs text-slate-500">{sidebarUserEmail}</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href={settingsHref}
                onClick={() => {
                  if (mobile) setMobileNavOpen(false);
                }}
                className="cursor-pointer"
              >
                <Settings2 className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <div className="px-1 pt-1">
              <Button
                type="button"
                variant="destructive"
                className="h-8 w-full justify-start gap-2 px-2"
                onClick={() => {
                  if (mobile) setMobileNavOpen(false);
                  void handleLogout();
                }}
                disabled={loggingOut}
              >
                <LogOut className="h-4 w-4" />
                {loggingOut ? "Logging out..." : "Logout"}
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  function renderShellBrand(options?: { mode?: "desktop" | "mobile-top" | "mobile-drawer" }) {
    const mode = options?.mode || "desktop";
    if (sidebarBadgeUrl) {
      const containerClass =
        mode === "mobile-top"
          ? "flex h-10 items-center rounded-md border border-blue-100 bg-white px-2"
          : "flex h-16 items-center justify-center rounded-lg border border-blue-100 bg-white px-2";
      const imageClass =
        mode === "mobile-top"
          ? "h-8 w-auto max-w-[150px] object-contain"
          : "h-14 w-auto max-w-[210px] object-contain";
      return (
        <div className={containerClass}>
          <img src={sidebarBadgeUrl} alt={`${title} school badge`} className={imageClass} />
        </div>
      );
    }

    const titleClass =
      mode === "desktop" ? "text-lg font-semibold text-blue-900" : "text-base font-semibold text-blue-900";
    return (
      <>
        <div className="text-xs uppercase tracking-wide text-blue-700/80">Platform</div>
        <div className={titleClass}>{title}</div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-blue-50/40">
      {/*
        ┌─ SIDEBAR (fixed) ──────────────────────────────────────────────────┐
        │  fixed + h-screen keeps it pinned while the page scrolls behind it │
        │  w-[260px] matches the md:grid-cols-[260px_1fr] column below        │
        └────────────────────────────────────────────────────────────────────┘
      */}
      <aside className="
        hidden md:flex md:flex-col
        fixed top-0 left-0 z-30
        h-screen w-[260px]
        border-r border-blue-100 bg-white/90
        overflow-y-auto
      ">
        <div className="p-4">
          {renderShellBrand({ mode: "desktop" })}
        </div>

        <Separator />

        <nav className="flex-1 space-y-1 px-3 py-3">
          {nav.map((item) => {
            const key = parseHref(item.href).path;
            const hasChildren = Boolean(item.children && item.children.length > 0);
            const childIsActive = (item.children || []).some((child) => isExactActive(child.href));
            const itemIsActive  = isPathActive(item.href) || childIsActive;
            const itemIsExpanded = hasChildren ? expandedModuleKey === key : false;
            const Icon = item.icon ? NAV_ICON_REGISTRY[item.icon] : undefined;
            const showItemBadge = Boolean(item.showUnreadBadge && unreadCount > 0);

            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center gap-1">
                  <Link
                    href={item.href}
                    className={cn(
                      "flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      itemIsActive
                        ? "bg-blue-100 font-medium text-blue-900"
                        : "text-muted-foreground hover:bg-blue-50 hover:text-blue-900"
                    )}
                  >
                    <span className="relative inline-flex h-4 w-4 items-center justify-center">
                      {Icon && <Icon className="h-4 w-4" />}
                      {showItemBadge && (
                        <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                          {unreadLabel}
                        </span>
                      )}
                    </span>
                    <span>{item.label}</span>
                  </Link>

                  {hasChildren && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() =>
                        setExpandedModuleKey((prev) => (prev === key ? null : key))
                      }
                      aria-label={`Toggle ${item.label} links`}
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          itemIsExpanded ? "rotate-180" : "rotate-0"
                        )}
                      />
                    </Button>
                  )}
                </div>

                {hasChildren && itemIsExpanded && (
                  <div className="space-y-1 pl-4">
                    {(item.children || []).map((child) => {
                      const childIsExactActive = isExactActive(child.href);
                      const ChildIcon = child.icon ? NAV_ICON_REGISTRY[child.icon] : undefined;
                      const showChildBadge = Boolean(child.showUnreadBadge && unreadCount > 0);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors",
                            childIsExactActive
                              ? "bg-blue-100 font-medium text-blue-900"
                              : "text-muted-foreground hover:bg-blue-50 hover:text-blue-900"
                          )}
                        >
                          <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
                            {ChildIcon && <ChildIcon className="h-3.5 w-3.5" />}
                            {showChildBadge && (
                              <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold text-white">
                                {unreadLabel}
                              </span>
                            )}
                          </span>
                          <span>{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {renderSidebarFooter()}
      </aside>

      <div className="sticky top-0 z-40 border-b border-blue-100 bg-white/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            {renderShellBrand({ mode: "mobile-top" })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="relative"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                {unreadLabel}
              </span>
            )}
          </Button>
        </div>
      </div>

      {mobileNavOpen && (
        <div className="md:hidden">
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-900/45"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu overlay"
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r border-blue-100 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                {renderShellBrand({ mode: "mobile-drawer" })}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Separator />
            <nav className="max-h-[calc(100vh-130px)] space-y-1 overflow-y-auto px-3 py-3">
              {nav.map((item) => {
                const key = parseHref(item.href).path;
                const hasChildren = Boolean(item.children && item.children.length > 0);
                const childIsActive = (item.children || []).some((child) => isExactActive(child.href));
                const itemIsActive = isPathActive(item.href) || childIsActive;
                const itemIsExpanded = hasChildren ? expandedModuleKey === key : false;
                const Icon = item.icon ? NAV_ICON_REGISTRY[item.icon] : undefined;
                const showItemBadge = Boolean(item.showUnreadBadge && unreadCount > 0);

                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center gap-1">
                      <Link
                        href={item.href}
                        onClick={() => setMobileNavOpen(false)}
                        className={cn(
                          "flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                          itemIsActive
                            ? "bg-blue-100 font-medium text-blue-900"
                            : "text-muted-foreground hover:bg-blue-50 hover:text-blue-900"
                        )}
                      >
                        <span className="relative inline-flex h-4 w-4 items-center justify-center">
                          {Icon && <Icon className="h-4 w-4" />}
                          {showItemBadge && (
                            <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                              {unreadLabel}
                            </span>
                          )}
                        </span>
                        <span>{item.label}</span>
                      </Link>

                      {hasChildren && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() =>
                            setExpandedModuleKey((prev) => (prev === key ? null : key))
                          }
                          aria-label={`Toggle ${item.label} links`}
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform",
                              itemIsExpanded ? "rotate-180" : "rotate-0"
                            )}
                          />
                        </Button>
                      )}
                    </div>

                    {hasChildren && itemIsExpanded && (
                      <div className="space-y-1 pl-4">
                        {(item.children || []).map((child) => {
                          const childIsExactActive = isExactActive(child.href);
                          const ChildIcon = child.icon ? NAV_ICON_REGISTRY[child.icon] : undefined;
                          const showChildBadge = Boolean(child.showUnreadBadge && unreadCount > 0);
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={() => setMobileNavOpen(false)}
                              className={cn(
                                "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors",
                                childIsExactActive
                                  ? "bg-blue-100 font-medium text-blue-900"
                                  : "text-muted-foreground hover:bg-blue-50 hover:text-blue-900"
                              )}
                            >
                              <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
                                {ChildIcon && <ChildIcon className="h-3.5 w-3.5" />}
                                {showChildBadge && (
                                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold text-white">
                                    {unreadLabel}
                                  </span>
                                )}
                              </span>
                              <span>{child.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
            {renderSidebarFooter({ mobile: true })}
          </aside>
        </div>
      )}


      <main className="min-h-screen bg-gradient-to-b from-blue-50/30 to-white p-4 md:ml-[260px] md:p-6">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      <FloatingSupportWidget
        enabled={supportWidgetEnabled}
        pageHref={supportWidgetPageHref}
      />
    </div>
  );
}
