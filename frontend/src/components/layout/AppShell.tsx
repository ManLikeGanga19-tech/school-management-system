"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  Bell,
  Building2,
  BookOpenCheck,
  BookOpenText,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Headset,
  ChevronDown,
  ClipboardCheck,
  FileBarChart,
  PenLine,
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
  DatabaseBackup,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  GraduationCap,
  Plus,
  Tag,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  UserCog,
  UserRoundPlus,
  Users,
  WalletCards,
  X,
  MessageSquare,
  Send,
  Megaphone,
  History,
  Coins,
  Hash,
  ScanLine,
  BookUser,
  UsersRound,
  CalendarOff,
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
import { SubscriptionBanner } from "@/components/layout/SubscriptionBanner";
import { ChangelogBanner } from "@/components/layout/ChangelogBanner";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { CampusSwitcher } from "@/components/layout/CampusSwitcher";
import { storage } from "@/lib/storage";
import { useSubscription } from "@/lib/auth/useSubscription";
import { usePermissions } from "@/lib/auth/usePermissions";

type AppNavLink = {
  href: string;
  label: string;
  icon?: string;
  showUnreadBadge?: boolean;
  badgeKey?: AppBadgeKey;
  /** If set, only show this item when the tenant's curriculum_type matches one of these values */
  curriculumGate?: string[];
  /** If set, only show this item when the tenant's subscription plan unlocks this module */
  moduleKey?: string;
  /** If set, only show this item when the current user's role holds this RBAC permission */
  permission?: string;
};

/**
 * Gateable module → the RBAC "view" permission that reveals it in the sidebar.
 * A module shows only when the tier unlocks it AND the role holds this permission.
 * Modules without an entry (events, etc.) are tier-gated only.
 */
const MODULE_VIEW_PERMISSION: Record<string, string> = {
  exams: "reports.view",
  cbc: "cbc.assessments.view",
  igcse: "reports.view",
  discipline: "discipline.incidents.view",
  messaging: "sms.send",
  hr: "hr.staff.view",
  analytics: "audit.read",
};

export type AppNavItem = AppNavLink & {
  children?: AppNavLink[];
};

export type AppBadgeKey = "tenantNotifications" | "saasRollout" | "saasSupport";

type BadgeCounts = Record<AppBadgeKey, number>;

const EMPTY_BADGE_COUNTS: BadgeCounts = {
  tenantNotifications: 0,
  saasRollout: 0,
  saasSupport: 0,
};

const NAV_ICON_REGISTRY: Record<string, LucideIcon> = {
  BadgeDollarSign,
  Bell,
  Building2,
  BookOpenCheck,
  BookOpenText,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Headset,
  ClipboardCheck,
  FileBarChart,
  PenLine,
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
  DatabaseBackup,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  GraduationCap,
  Plus,
  Tag,
  UserCog,
  UserRoundPlus,
  Users,
  WalletCards,
  MessageSquare,
  Send,
  Megaphone,
  History,
  Coins,
  Hash,
  ScanLine,
  BookUser,
  UsersRound,
  CalendarOff,
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

function resolveBadgeKey(link: AppNavLink): AppBadgeKey | null {
  if (link.badgeKey) return link.badgeKey;
  if (link.showUnreadBadge) return "tenantNotifications";
  return null;
}

// Tenant profile (curriculum + school name) cached across client-side
// navigations and persisted for hard reloads. Each page renders its own
// AppShell, so without this the curriculum gate would re-resolve from scratch
// on every navigation — flashing un-gated nav items into the sidebar until the
// /tenants/profile fetch returns. Booting from this snapshot keeps the gated
// sidebar stable from the very first render of every page.
type TenantProfileSnapshot = { curriculumType: string; schoolName: string; isDemo?: boolean };
let tenantProfileCache: TenantProfileSnapshot | null = null;
const TENANT_PROFILE_STORAGE_KEY = "sms_tenant_profile";

function readTenantProfile(): TenantProfileSnapshot | null {
  if (tenantProfileCache) return tenantProfileCache;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TENANT_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TenantProfileSnapshot>;
    tenantProfileCache = {
      curriculumType: String(parsed.curriculumType || ""),
      schoolName: String(parsed.schoolName || ""),
      isDemo: Boolean(parsed.isDemo),
    };
    return tenantProfileCache;
  } catch {
    return null;
  }
}

function writeTenantProfile(snap: TenantProfileSnapshot): void {
  tenantProfileCache = snap;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TENANT_PROFILE_STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// The school badge is identical on every page — cache it (as a data URL, so
// there's no object-URL lifecycle to manage) so it isn't re-fetched and
// re-painted on every navigation. undefined = not fetched, null = no badge.
let sidebarBadgeCache: string | null | undefined;

// The signed-in user's sidebar identity, cached so a navigation doesn't blank
// the name back to "Tenant user" while /auth/me re-resolves.
let sidebarUserCache: { email: string; name: string } | null = null;

// Flips true after the first client mount. The server render and the first
// client (hydration) render must produce identical HTML, so cached values
// from sessionStorage/module memory must NOT seed initial state until after
// hydration — otherwise React throws hydration error #418 and regenerates the
// whole tree. On every later (client-side navigation) mount this is already
// true, so the cache seeds state immediately with no flash.
let appShellHydrated = false;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
  // Boot the curriculum gate from the cached snapshot so a page navigation
  // never flashes curriculum-gated nav items before /tenants/profile loads.
  // Cached seeds are only used once hydrated — see appShellHydrated above.
  const [curriculumType, setCurriculumType] = useState<string | null>(
    () => (appShellHydrated ? readTenantProfile()?.curriculumType || null : null)
  );
  const [schoolName, setSchoolName] = useState<string | null>(
    () => (appShellHydrated ? readTenantProfile()?.schoolName || null : null)
  );
  // Read-only demo tenant → drives the DemoBanner. false for every real tenant.
  const [isDemo, setIsDemo] = useState<boolean>(
    () => (appShellHydrated ? Boolean(readTenantProfile()?.isDemo) : false)
  );
  const [badgeCounts, setBadgeCounts] = useState<BadgeCounts>(EMPTY_BADGE_COUNTS);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Desktop sidebar collapse — init false (SSR-safe), restored from storage
  // after hydration to avoid a hydration mismatch.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountMenuOpenDesktop, setAccountMenuOpenDesktop] = useState(false);
  const [accountMenuOpenMobile, setAccountMenuOpenMobile] = useState(false);
  const [sidebarUserEmail, setSidebarUserEmail] = useState(
    () => (appShellHydrated && sidebarUserCache ? sidebarUserCache.email : "Tenant user")
  );
  const [sidebarUserName, setSidebarUserName] = useState(
    () => (appShellHydrated && sidebarUserCache ? sidebarUserCache.name : "")
  );
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarBadgeUrl, setSidebarBadgeUrl] = useState<string | null>(
    () => (appShellHydrated && typeof sidebarBadgeCache === "string" ? sidebarBadgeCache : null)
  );
  const seenUnreadIdsRef = useRef<Set<string>>(new Set());
  const initializedRealtimeRef = useRef(false);
  const lastNotificationSoundAtRef = useRef(0);

  // Once the first client render has hydrated, seed the sidebar from the
  // cross-navigation caches. Doing this in an effect (not in useState) keeps
  // the hydration render identical to the server's — avoiding React #418.
  useEffect(() => {
    try {
      setSidebarCollapsed(storage.get("sms_sidebar_collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        storage.set("sms_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    appShellHydrated = true;
    const snap = readTenantProfile();
    if (snap?.curriculumType) setCurriculumType((c) => c ?? snap.curriculumType);
    if (snap?.schoolName) setSchoolName((s) => s ?? snap.schoolName);
    if (sidebarUserCache) {
      const cached = sidebarUserCache;
      setSidebarUserEmail((e) => (e === "Tenant user" ? cached.email : e));
      setSidebarUserName((n) => n || cached.name);
    }
    if (typeof sidebarBadgeCache === "string") {
      const cachedBadge = sidebarBadgeCache;
      setSidebarBadgeUrl((u) => u ?? cachedBadge);
    }
    // Run once per mount — intentionally no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const settingsHref = useMemo(() => resolveSettingsHref(pathname || "/"), [pathname]);

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
        // Only fall back to the placeholder when nothing is cached — a
        // navigation must not blank the name while /auth/me re-resolves.
        if (!cancelled && !sidebarUserCache) {
          setSidebarUserEmail("Tenant user");
          setSidebarUserName("");
        }
        try {
          const raw = await api.get<unknown>("/auth/me", {
            tenantRequired: true,
            noRedirect: true,
          });
          const parsed = normalizeCurrentUserPreview(raw);
          if (parsed) {
            const email = parsed.email || "Tenant user";
            const name = parsed.fullName || "";
            sidebarUserCache = { email, name };
            if (!cancelled) {
              setSidebarUserEmail(email);
              setSidebarUserName(name);
            }
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

  useEffect(() => {
    let cancelled = false;
    const path = pathname || "/";
    if (!path.startsWith("/tenant/")) return;

    async function loadCurriculumType() {
      try {
        const raw = await api.get<unknown>("/tenants/profile", {
          tenantRequired: true,
          noRedirect: true,
        });
        const obj = asObject(raw);
        const ct = asString(obj?.curriculum_type).toUpperCase() || "8-4-4";
        const nm =
          asString(obj?.name) ||
          asString(obj?.school_name) ||
          asString(obj?.tenant_name);
        const demo = Boolean(obj?.is_demo);
        if (!cancelled) {
          setCurriculumType(ct);
          if (nm) setSchoolName(nm);
          setIsDemo(demo);
        }
        // Cache for the next navigation so the gated sidebar never flashes.
        writeTenantProfile({
          curriculumType: ct,
          schoolName: nm || tenantProfileCache?.schoolName || "",
          isDemo: demo,
        });
      } catch {
        // Leave null — show all nav items
      }
    }

    void loadCurriculumType();
    return () => { cancelled = true; };
  }, [pathname]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await authLogout();
    } catch {
      // Best effort logout; redirect anyway.
    } finally {
      // Drop cached tenant state so the next sign-in (possibly a different
      // tenant in the same tab) never inherits this one's sidebar.
      tenantProfileCache = null;
      sidebarBadgeCache = undefined;
      sidebarUserCache = null;
      try {
        window.sessionStorage.removeItem(TENANT_PROFILE_STORAGE_KEY);
      } catch {
        /* ignore */
      }
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

  const loadSidebarBadge = useCallback(async (force = false) => {
    const path = pathname || "/";
    if (!path.startsWith("/tenant/")) {
      replaceSidebarBadgeUrl(null);
      return;
    }

    // Serve the cached badge instantly on a navigation — only hit the network
    // on the first load of the session or when branding is explicitly updated.
    if (!force && sidebarBadgeCache !== undefined) {
      replaceSidebarBadgeUrl(
        typeof sidebarBadgeCache === "string" ? sidebarBadgeCache : null
      );
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
        sidebarBadgeCache = null;
        replaceSidebarBadgeUrl(null);
        return;
      }
      const dataUrl = await blobToDataUrl(blob);
      sidebarBadgeCache = dataUrl;
      replaceSidebarBadgeUrl(dataUrl);
    } catch {
      replaceSidebarBadgeUrl(
        typeof sidebarBadgeCache === "string" ? sidebarBadgeCache : null
      );
    }
  }, [pathname, replaceSidebarBadgeUrl]);

  useEffect(() => {
    void loadSidebarBadge();
  }, [loadSidebarBadge]);

  useEffect(() => {
    const handleBrandingUpdated = () => {
      // Branding changed — drop the cache and re-fetch.
      sidebarBadgeCache = undefined;
      void loadSidebarBadge(true);
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

  const { subscription, ready: subReady } = useSubscription();
  const subModules = subscription?.modules;
  const { has: hasPermission, loading: permLoading } = usePermissions();

  const filteredNav = useMemo(() => {
    return nav.filter((item) => {
      // Curriculum gate (only applies once curriculum_type is known).
      if (
        curriculumType &&
        item.curriculumGate &&
        !item.curriculumGate.includes(curriculumType)
      ) {
        return false;
      }
      // Subscription module gate — fail-CLOSED: a gateable nav item appears
      // only once we know the plan includes it, so modules a tenant isn't
      // entitled to never flash into the sidebar before the state loads.
      if (item.moduleKey) {
        if (!subReady || !subModules || !subModules.includes(item.moduleKey)) {
          return false;
        }
      }
      // RBAC gate — a module shows only when the current role holds its view
      // permission (explicit item.permission, or the module's mapped permission).
      // Fail-OPEN while permissions load (avoids flicker; pages enforce the real
      // boundary), then hide once we know the role lacks it.
      const requiredPerm = item.permission || (item.moduleKey ? MODULE_VIEW_PERMISSION[item.moduleKey] : undefined);
      if (requiredPerm && !permLoading && !hasPermission(requiredPerm)) {
        return false;
      }
      return true;
    });
  }, [nav, curriculumType, subReady, subModules, permLoading, hasPermission]);

  const requestedBadgeKeys = useMemo(() => {
    const keys = new Set<AppBadgeKey>();
    for (const item of filteredNav) {
      const itemBadgeKey = resolveBadgeKey(item);
      if (itemBadgeKey) keys.add(itemBadgeKey);
      for (const child of item.children || []) {
        const childBadgeKey = resolveBadgeKey(child);
        if (childBadgeKey) keys.add(childBadgeKey);
      }
    }
    return keys;
  }, [filteredNav]);

  useEffect(() => {
    if (requestedBadgeKeys.size === 0) {
      setBadgeCounts(EMPTY_BADGE_COUNTS);
      seenUnreadIdsRef.current = new Set();
      initializedRealtimeRef.current = false;
      return;
    }

    let cancelled = false;
    async function pollBadges() {
      const nextBadgeCounts: BadgeCounts = { ...EMPTY_BADGE_COUNTS };

      if (requestedBadgeKeys.has("tenantNotifications")) {
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
          nextBadgeCounts.tenantNotifications =
            Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;

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
        } catch {
          nextBadgeCounts.tenantNotifications = 0;
        }
      } else {
        seenUnreadIdsRef.current = new Set();
        initializedRealtimeRef.current = false;
      }

      if (requestedBadgeKeys.has("saasRollout")) {
        try {
          const rolloutRaw = await api.get<unknown>("/admin/saas/rollout/requests?limit=1&offset=0", {
            tenantRequired: false,
            noRedirect: true,
          });
          const rolloutPayload = asObject(rolloutRaw);
          const counts = asObject(rolloutPayload?.counts);
          const activeRolloutCount =
            Number(counts?.new || 0) +
            Number(counts?.contacting || 0) +
            Number(counts?.scheduled || 0);
          nextBadgeCounts.saasRollout =
            Number.isFinite(activeRolloutCount) && activeRolloutCount > 0
              ? Math.floor(activeRolloutCount)
              : 0;
        } catch {
          nextBadgeCounts.saasRollout = 0;
        }
      }

      if (requestedBadgeKeys.has("saasSupport")) {
        try {
          const supportRaw = await api.get<unknown>("/support/admin/unread-count", {
            tenantRequired: false,
            noRedirect: true,
          });
          const payload = asObject(supportRaw) || {};
          const parsed = Number(payload.unread_count);
          nextBadgeCounts.saasSupport =
            Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
        } catch {
          nextBadgeCounts.saasSupport = 0;
        }
      }

      if (!cancelled) {
        setBadgeCounts(nextBadgeCounts);
      }
    }

    void pollBadges();
    const timer = window.setInterval(() => {
      void pollBadges();
    }, 8_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [playNotificationPop, requestedBadgeKeys]);

  const isPathActive  = (href: string) => parseHref(href).path === active.path;
  const isExactActive = (href: string) => parseHref(href).full === active.full;
  const badgeCountFor = useCallback(
    (link: AppNavLink) => {
      const badgeKey = resolveBadgeKey(link);
      return badgeKey ? badgeCounts[badgeKey] || 0 : 0;
    },
    [badgeCounts]
  );
  const badgeLabelFor = useCallback((count: number) => (count > 99 ? "99+" : String(count)), []);
  const menuBadgeCount = useMemo(
    () => Array.from(requestedBadgeKeys).reduce((sum, key) => sum + (badgeCounts[key] || 0), 0),
    [badgeCounts, requestedBadgeKeys]
  );
  const accountLabel = sidebarUserName || "Signed in user";

  function renderSidebarFooter(options?: { mobile?: boolean }) {
    const mobile = Boolean(options?.mobile);
    const accountMenuOpen = mobile ? accountMenuOpenMobile : accountMenuOpenDesktop;
    const setAccountMenuOpen = mobile ? setAccountMenuOpenMobile : setAccountMenuOpenDesktop;
    const acctInitials = (sidebarUserName || sidebarUserEmail || "U")
      .trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "U";
    return (
      <div
        className={cn("border-t border-white/10 p-3", !mobile && "pt-2")}
      >

        <DropdownMenu open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-auto w-full items-center justify-start gap-3 px-2 py-2 text-white hover:bg-white/[0.06] hover:text-white">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--tenant-accent)] text-xs font-bold text-[#3a2a0a]">
                {acctInitials}
              </span>
              <span className="min-w-0 flex-1 text-left leading-tight">
                <span className="block truncate text-sm font-semibold text-white">
                  {sidebarUserName || "Signed in"}
                </span>
                <span className="block truncate text-xs text-white/45">
                  {sidebarUserEmail}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-white/40 transition-transform",
                  accountMenuOpen ? "rotate-0" : "rotate-180"
                )}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            className="tenant-theme w-64 border-[var(--tenant-border)] bg-[var(--tenant-surface)] text-[var(--tenant-ink)]"
          >
            <DropdownMenuLabel className="truncate text-[var(--tenant-ink)]">{accountLabel}</DropdownMenuLabel>
            <div className="px-2 pb-1 text-xs text-[var(--tenant-muted)]">{sidebarUserEmail}</div>
            <DropdownMenuSeparator className="bg-[var(--tenant-border)]" />
            <DropdownMenuItem asChild>
              <Link
                href={settingsHref}
                onClick={() => {
                  if (mobile) setMobileNavOpen(false);
                }}
                className="cursor-pointer text-[var(--tenant-ink)] focus:bg-[var(--tenant-surface-2)] focus:text-[var(--tenant-ink)]"
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
    // Mobile top bar sits on a light surface — keep the compact badge/text dark.
    if (mode === "mobile-top") {
      return sidebarBadgeUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sidebarBadgeUrl} alt={`${title} school badge`} className="h-8 w-auto max-w-[150px] object-contain" />
      ) : (
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-wide text-[#7c4b24]">{schoolName || "Platform"}</div>
          <div className="text-base font-semibold text-[#132129]">{title}</div>
        </div>
      );
    }

    // Desktop + drawer: dark bronze frame — compact logo + school name + role,
    // mirroring the admin sidebar brand.
    return (
      <div className="flex items-center gap-3">
        {sidebarBadgeUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sidebarBadgeUrl} alt={`${title} school badge`} className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-0.5" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--tenant-accent)] text-sm font-bold text-[#3a2a0a]">
            {(schoolName || title || "S").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-bold tracking-tight text-white">{schoolName || title}</div>
          <div className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">{title}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="tenant-theme dashboard-app-bg min-h-screen">
      {/*
        ┌─ SIDEBAR (fixed) ──────────────────────────────────────────────────┐
        │  fixed + h-screen keeps it pinned while the page scrolls behind it │
        │  w-[260px] matches the md:grid-cols-[260px_1fr] column below        │
        └────────────────────────────────────────────────────────────────────┘
      */}
      <aside className={cn(
        "hidden md:flex md:flex-col",
        "fixed top-0 left-0 z-30 h-screen",
        "border-r border-black/20 bg-[var(--tenant-sidebar)]",
        "overflow-y-auto overflow-x-hidden transition-[width] duration-200",
        sidebarCollapsed ? "w-[76px]" : "w-[260px]"
      )}>
        <div className={cn("flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3", sidebarCollapsed ? "flex-col justify-center py-3" : "h-16")}>
          {sidebarCollapsed ? (
            sidebarBadgeUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sidebarBadgeUrl} alt="School badge" className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-0.5" />
            ) : null
          ) : (
            <div className="min-w-0 flex-1">{renderShellBrand({ mode: "desktop" })}</div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-md border border-white/15 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        {!sidebarCollapsed && <CampusSwitcher />}

        <Separator className="bg-white/10" />

        <nav className="flex-1 space-y-1 px-3 py-3">
          {filteredNav.map((item) => {
            const key = parseHref(item.href).path;
            const hasChildren = Boolean(item.children && item.children.length > 0);
            const childIsActive = (item.children || []).some((child) => isExactActive(child.href));
            const itemIsActive  = isPathActive(item.href) || childIsActive;
            const itemIsExpanded = hasChildren ? expandedModuleKey === key : false;
            const Icon = item.icon ? NAV_ICON_REGISTRY[item.icon] : undefined;
            const itemBadgeCount = badgeCountFor(item);
            const showItemBadge = itemBadgeCount > 0;
            const itemBadgeLabel = badgeLabelFor(itemBadgeCount);

            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center gap-1">
                  <Link
                    href={item.href}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={cn(
                      "group relative flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                      sidebarCollapsed && "justify-center px-2",
                      itemIsActive
                        ? "bg-white/[0.06] font-semibold text-white"
                        : "font-medium text-white/60 hover:bg-white/[0.04] hover:text-white"
                    )}
                  >
                    {itemIsActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-[var(--tenant-accent)]" />}
                    <span className="relative inline-flex h-[18px] w-[18px] items-center justify-center">
                      {Icon && <Icon className={cn("h-[18px] w-[18px]", itemIsActive && "text-[var(--tenant-accent)]")} />}
                      {showItemBadge && (
                        <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                          {itemBadgeLabel}
                        </span>
                      )}
                    </span>
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </Link>

                  {hasChildren && !sidebarCollapsed && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-white/70 hover:bg-white/10 hover:text-white"
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

                {hasChildren && itemIsExpanded && !sidebarCollapsed && (
                  <div className="space-y-1 pl-4">
                    {(item.children || [])
                      .filter((child) => {
                        // RBAC gate for sub-items — fail-OPEN while permissions
                        // load, then hide once we know the role lacks the
                        // child's required permission (pages still enforce it).
                        const childPerm = child.permission;
                        return !(childPerm && !permLoading && !hasPermission(childPerm));
                      })
                      .map((child) => {
                      const childIsExactActive = isExactActive(child.href);
                      const ChildIcon = child.icon ? NAV_ICON_REGISTRY[child.icon] : undefined;
                      const childBadgeCount = badgeCountFor(child);
                      const showChildBadge = childBadgeCount > 0;
                      const childBadgeLabel = badgeLabelFor(childBadgeCount);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors",
                            childIsExactActive
                              ? "bg-white/[0.06] font-semibold text-white"
                              : "font-medium text-white/60 hover:bg-white/[0.04] hover:text-white"
                          )}
                        >
                          {childIsExactActive && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-[var(--tenant-accent)]" />}
                          <span className="relative inline-flex h-4 w-4 items-center justify-center">
                            {ChildIcon && <ChildIcon className={cn("h-4 w-4", childIsExactActive && "text-[var(--tenant-accent)]")} />}
                            {showChildBadge && (
                              <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold text-white">
                                {childBadgeLabel}
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

        {!sidebarCollapsed && renderSidebarFooter()}
      </aside>

      <div className="sticky top-0 z-40 border-b border-[var(--tenant-border)] bg-[var(--tenant-surface)]/92 backdrop-blur-xl md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            {renderShellBrand({ mode: "mobile-top" })}
          </div>
          <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="relative"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" />
            {menuBadgeCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                {badgeLabelFor(menuBadgeCount)}
              </span>
            )}
          </Button>
          </div>
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
            className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r border-black/20 bg-[var(--tenant-sidebar)] shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                {renderShellBrand({ mode: "mobile-drawer" })}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Separator className="bg-white/10" />
            <div className="pt-2"><CampusSwitcher /></div>
            <nav className="max-h-[calc(100vh-180px)] space-y-1 overflow-y-auto px-3 py-3">
              {filteredNav.map((item) => {
                const key = parseHref(item.href).path;
                const hasChildren = Boolean(item.children && item.children.length > 0);
                const childIsActive = (item.children || []).some((child) => isExactActive(child.href));
                const itemIsActive = isPathActive(item.href) || childIsActive;
                const itemIsExpanded = hasChildren ? expandedModuleKey === key : false;
                const Icon = item.icon ? NAV_ICON_REGISTRY[item.icon] : undefined;
                const itemBadgeCount = badgeCountFor(item);
                const showItemBadge = itemBadgeCount > 0;
                const itemBadgeLabel = badgeLabelFor(itemBadgeCount);

                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center gap-1">
                      <Link
                        href={item.href}
                        onClick={() => setMobileNavOpen(false)}
                        className={cn(
                          "group relative flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                          itemIsActive
                            ? "bg-white/[0.06] font-semibold text-white"
                            : "font-medium text-white/60 hover:bg-white/[0.04] hover:text-white"
                        )}
                      >
                        <span className="relative inline-flex h-4 w-4 items-center justify-center">
                          {Icon && <Icon className="h-4 w-4" />}
                          {showItemBadge && (
                            <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                              {itemBadgeLabel}
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
                          className="h-8 w-8 shrink-0 text-white/70 hover:bg-white/10 hover:text-white"
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
                          const childBadgeCount = badgeCountFor(child);
                          const showChildBadge = childBadgeCount > 0;
                          const childBadgeLabel = badgeLabelFor(childBadgeCount);
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={() => setMobileNavOpen(false)}
                              className={cn(
                                "group relative flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors",
                                childIsExactActive
                                  ? "bg-white/[0.06] font-semibold text-white"
                                  : "font-medium text-white/60 hover:bg-white/[0.04] hover:text-white"
                              )}
                            >
                              {childIsExactActive && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-[var(--tenant-accent)]" />}
                              <span className="relative inline-flex h-4 w-4 items-center justify-center">
                                {ChildIcon && <ChildIcon className={cn("h-4 w-4", childIsExactActive && "text-[var(--tenant-accent)]")} />}
                                {showChildBadge && (
                                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold text-white">
                                    {childBadgeLabel}
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


      <main className={cn(
        "min-h-screen overflow-x-hidden bg-[var(--tenant-bg)]",
        "px-3 py-4 sm:px-4 md:px-6 md:py-6 transition-[margin] duration-200",
        sidebarCollapsed ? "md:ml-[76px]" : "md:ml-[260px]"
      )}>
        <div className="mx-auto w-full max-w-6xl">
          {isDemo && <DemoBanner />}
          {/* Subscription/renewal state is a TENANT concern — never show it in the
              super-admin (/saas) console, which has no tenant subscription. */}
          {!pathname.startsWith("/saas") && <SubscriptionBanner />}
          <ChangelogBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
