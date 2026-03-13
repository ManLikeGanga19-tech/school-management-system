import { apiFetch } from "@/lib/api";

export type BillingPlan = "per_term" | "per_year";

export type SubscriptionBillingEligibility = {
  billing_plan: BillingPlan;
  source: "saas_academic_calendar" | "fallback";
  as_of: string;
  academic_year: number;
  label: string;
  eligible_from_date: string;
  eligible_until_date: string;
  term_no?: number | null;
  term_code?: string | null;
  term_name?: string | null;
};

export async function fetchSubscriptionBillingEligibility(
  billingPlan: BillingPlan,
  asOf?: string | null
) {
  const qs = new URLSearchParams({ billing_plan: billingPlan });
  if (asOf && asOf.trim()) qs.set("as_of", asOf.trim());

  return apiFetch<SubscriptionBillingEligibility>(
    `/admin/subscriptions/eligibility?${qs.toString()}`,
    {
      method: "GET",
      tenantRequired: false,
    }
  );
}
