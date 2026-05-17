"use client";

/**
 * SubscriptionBanner — renders a renewal notice when the tenant's
 * subscription is in its grace window or locked. Renders nothing when active.
 */
import { AlertTriangle, Lock } from "lucide-react";
import { useSubscription } from "@/lib/auth/useSubscription";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-KE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function SubscriptionBanner() {
  const { subscription, isGrace, isLocked } = useSubscription();

  if (!subscription || (!isGrace && !isLocked)) return null;

  if (isLocked) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="text-sm text-red-800">
          <p className="font-semibold">Subscription expired — the system is read-only</p>
          <p className="mt-0.5 text-red-700">
            Your{subscription.plan_name ? ` ${subscription.plan_name}` : ""} subscription
            ended on {formatDate(subscription.period_end)} and the grace period has
            passed. Your data is safe and fully visible, but changes are blocked until
            the subscription is renewed.
          </p>
        </div>
      </div>
    );
  }

  // Grace
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="text-sm text-amber-800">
        <p className="font-semibold">Subscription renewal due</p>
        <p className="mt-0.5 text-amber-700">
          Your{subscription.plan_name ? ` ${subscription.plan_name}` : ""} subscription
          expired on {formatDate(subscription.period_end)}. Renew before{" "}
          <span className="font-semibold">{formatDate(subscription.grace_until)}</span> to
          avoid the system becoming read-only.
        </p>
      </div>
    </div>
  );
}
