"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BadgeDollarSign,
  Bell,
  Building2,
  BookOpenText,
  BriefcaseBusiness,
  CalendarDays,
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
  School,
  ScrollText,
  Settings2,
  ShieldCheck,
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
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  const searchParams = useSearchParams();

  const currentHref = useMemo(() => {
    if (activeHref && activeHref.trim()) return activeHref;
    const qs = searchParams?.toString();
    return `${normalizePath(pathname || "/")}${qs ? `?${qs}` : ""}`;
  }, [activeHref, pathname, searchParams]);

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
  const seenUnreadIdsRef = useRef<Set<string>>(new Set());
  const initializedRealtimeRef = useRef(false);

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
  }, [shouldLoadUnreadCount]);

  const isPathActive  = (href: string) => parseHref(href).path === active.path;
  const isExactActive = (href: string) => parseHref(href).full === active.full;
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);

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
          <div className="text-xs uppercase tracking-wide text-blue-700/80">Platform</div>
          <div className="text-lg font-semibold text-blue-900">{title}</div>
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
                              ? "bg-blue-50 font-medium text-blue-800"
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

        <div className="p-3">
          <form action="/api/auth/logout" method="post">
            <Button variant="outline" className="w-full">
              Logout
            </Button>
          </form>
        </div>
      </aside>

      <div className="sticky top-0 z-40 border-b border-blue-100 bg-white/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-blue-700/80">Platform</div>
            <div className="text-base font-semibold text-blue-900">{title}</div>
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
          <aside className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r border-blue-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-blue-700/80">Platform</div>
                <div className="text-base font-semibold text-blue-900">{title}</div>
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
                                  ? "bg-blue-50 font-medium text-blue-800"
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
            <div className="border-t border-blue-100 p-3">
              <form action="/api/auth/logout" method="post">
                <Button variant="outline" className="w-full">
                  Logout
                </Button>
              </form>
            </div>
          </aside>
        </div>
      )}


      <main className="md:ml-[260px] min-h-screen bg-gradient-to-b from-blue-50/30 to-white p-4 md:p-6">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
