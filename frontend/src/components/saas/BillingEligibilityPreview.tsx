"use client";

import { AlertTriangle, CalendarDays, LoaderCircle, Sparkles } from "lucide-react";

import type { SubscriptionBillingEligibility } from "@/lib/admin/subscription-eligibility";

type BillingEligibilityPreviewProps = {
  eligibility: SubscriptionBillingEligibility | null;
  loading: boolean;
  error?: string | null;
  title?: string;
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function BillingEligibilityPreview({
  eligibility,
  loading,
  error,
  title = "Billing eligibility",
}: BillingEligibilityPreviewProps) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-500">
        <div className="flex items-center gap-2">
          <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />
          Checking the active academic calendar...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <div className="font-medium">{title}</div>
            <div className="mt-1 text-xs text-amber-700">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!eligibility) return null;

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/90 px-4 py-3 text-sm text-slate-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
            <Sparkles className="h-3.5 w-3.5" />
            {title}
          </div>
          <div className="mt-1 text-base font-semibold text-slate-900">
            {eligibility.label}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Academic Year {eligibility.academic_year}
            {eligibility.term_code ? ` • ${eligibility.term_code}` : ""}
          </div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
          <CalendarDays className="h-3.5 w-3.5" />
          {eligibility.source === "saas_academic_calendar" ? "SaaS calendar" : "Fallback window"}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Eligible From
          </div>
          <div className="mt-1 font-medium text-slate-900">{formatDate(eligibility.eligible_from_date)}</div>
        </div>
        <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Window Ends
          </div>
          <div className="mt-1 font-medium text-slate-900">{formatDate(eligibility.eligible_until_date)}</div>
        </div>
      </div>
    </div>
  );
}
