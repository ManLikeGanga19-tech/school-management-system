"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { SubscriptionTabs } from "./SubscriptionTabs";

export default function SubscriptionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminShell title="Super Admin" activeHref="/saas/subscriptions">
      <SubscriptionTabs />
      {children}
    </AdminShell>
  );
}
