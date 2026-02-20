"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  const active = parseHref(activeHref || "");

  const activeModuleKey = useMemo(() => {
    const activeByChild = nav.find((item) =>
      (item.children || []).some((child) => parseHref(child.href).full === active.full)
    );
    if (activeByChild) {
      return parseHref(activeByChild.href).path;
    }

    const activeByPath = nav.find((item) => parseHref(item.href).path === active.path);
    return activeByPath ? parseHref(activeByPath.href).path : null;
  }, [active.full, active.path, nav]);

  const [expandedModuleKey, setExpandedModuleKey] = useState<string | null>(activeModuleKey);

  useEffect(() => {
    setExpandedModuleKey(activeModuleKey);
  }, [activeModuleKey]);

  const isPathActive = (href: string) => parseHref(href).path === active.path;
  const isExactActive = (href: string) => parseHref(href).full === active.full;

  return (
    <div className="min-h-screen bg-blue-50/40">
      <div className="mx-auto min-h-screen w-full md:grid md:grid-cols-[260px_1fr]">
        <aside className="border-b border-blue-100 bg-white/90 md:flex md:flex-col md:border-b-0 md:border-r">
          <div className="p-4">
            <div className="text-xs uppercase tracking-wide text-blue-700/80">Platform</div>
            <div className="text-lg font-semibold text-blue-900">{title}</div>
          </div>

          <Separator />

          <nav className="flex gap-1 overflow-x-auto px-3 py-3 md:block md:space-y-1 md:overflow-visible">
            {nav.map((item) => {
              const key = parseHref(item.href).path;
              const hasChildren = Boolean(item.children && item.children.length > 0);
              const childIsActive = (item.children || []).some((child) => isExactActive(child.href));
              const itemIsActive = isPathActive(item.href) || childIsActive;
              const itemIsExpanded = hasChildren ? expandedModuleKey === key : false;

              return (
                <div key={item.href} className="shrink-0 space-y-1 md:shrink">
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
                    <div className="pl-4 space-y-1">
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

          <div className="p-3 pt-0 md:mt-auto md:pt-3">
            <form action="/api/auth/logout" method="post">
              <Button variant="outline" className="w-full">
                Logout
              </Button>
            </form>
          </div>
        </aside>

        <main className="bg-gradient-to-b from-blue-50/30 to-white p-4 md:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
