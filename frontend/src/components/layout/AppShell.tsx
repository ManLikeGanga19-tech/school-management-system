"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export type AppNavItem = {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
};

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

  useEffect(() => {
    setExpandedModuleKey(activeModuleKey);
  }, [activeModuleKey]);

  const isPathActive  = (href: string) => parseHref(href).path === active.path;
  const isExactActive = (href: string) => parseHref(href).full === active.full;

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

            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center gap-1">
                  <Link
                    href={item.href}
                    className={cn(
                      "block flex-1 rounded-md px-3 py-2 text-sm transition-colors",
                      itemIsActive
                        ? "bg-blue-100 font-medium text-blue-900"
                        : "text-muted-foreground hover:bg-blue-50 hover:text-blue-900"
                    )}
                  >
                    {item.label}
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
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "block rounded-md px-3 py-1.5 text-xs transition-colors",
                            childIsExactActive
                              ? "bg-blue-50 font-medium text-blue-800"
                              : "text-muted-foreground hover:bg-blue-50 hover:text-blue-900"
                          )}
                        >
                          {child.label}
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

      {/*
        ┌─ MOBILE sidebar (top bar, unchanged behaviour) ────────────────────┐
        │  Shows on small screens where fixed sidebar is hidden               │
        └────────────────────────────────────────────────────────────────────┘
      */}
      <div className="md:hidden border-b border-blue-100 bg-white/90">
        <div className="p-4">
          <div className="text-xs uppercase tracking-wide text-blue-700/80">Platform</div>
          <div className="text-lg font-semibold text-blue-900">{title}</div>
        </div>
        <Separator />
        <nav className="flex gap-1 overflow-x-auto px-3 py-3">
          {nav.map((item) => {
            const key = parseHref(item.href).path;
            const childIsActive = (item.children || []).some((child) => isExactActive(child.href));
            const itemIsActive  = isPathActive(item.href) || childIsActive;
            return (
              <Link
                key={key}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-md px-3 py-2 text-sm transition-colors",
                  itemIsActive
                    ? "bg-blue-100 font-medium text-blue-900"
                    : "text-muted-foreground hover:bg-blue-50 hover:text-blue-900"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 pt-0">
          <form action="/api/auth/logout" method="post">
            <Button variant="outline" className="w-full">Logout</Button>
          </form>
        </div>
      </div>


      <main className="md:ml-[260px] min-h-screen bg-gradient-to-b from-blue-50/30 to-white p-4 md:p-6">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}