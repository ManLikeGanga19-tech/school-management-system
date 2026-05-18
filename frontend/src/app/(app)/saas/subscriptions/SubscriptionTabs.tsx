"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Layers, Building2, CreditCard } from "lucide-react";

const TABS = [
  { href: "/saas/subscriptions/tenants", label: "Tenants", icon: Users },
  { href: "/saas/subscriptions/plans", label: "Plans", icon: Layers },
  { href: "/saas/subscriptions/groups", label: "Groups", icon: Building2 },
  { href: "/saas/subscriptions/billing", label: "Billing", icon: CreditCard },
];

export function SubscriptionTabs() {
  const pathname = usePathname() || "";

  return (
    <div className="mb-5 border-b border-slate-200">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
                active
                  ? "border-teal-600 text-teal-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
