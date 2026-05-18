import { redirect } from "next/navigation";

export default function SubscriptionsIndex() {
  // The Subscriptions hub opens on the Tenants tab.
  redirect("/saas/subscriptions/tenants");
}
