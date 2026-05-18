"use client";

import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { SubscriptionTabs } from "./SubscriptionTabs";

export default function SubscriptionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/subscriptions">
      <SubscriptionTabs />
      {children}
    </AppShell>
  );
}
