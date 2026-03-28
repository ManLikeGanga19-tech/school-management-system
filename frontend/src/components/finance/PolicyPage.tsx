"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, Save } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import type { AppNavItem } from "@/components/layout/AppShell";
import { TenantPageHeader } from "@/components/tenant/page-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { apiFetch } from "@/lib/api";
import { asObject, readApiError } from "./finance-utils";

type Policy = {
  allow_partial_enrollment: boolean;
  min_percent_to_enroll: number | null;
  min_amount_to_enroll: string | null;
  require_interview_fee_before_submit: boolean;
};

const DEFAULT_POLICY: Policy = {
  allow_partial_enrollment: false,
  min_percent_to_enroll: null,
  min_amount_to_enroll: null,
  require_interview_fee_before_submit: true,
};

type Props = {
  nav: AppNavItem[];
  activeHref: string;
};

function normalizePolicy(value: unknown): Policy {
  const obj = asObject(value);
  if (!obj) return DEFAULT_POLICY;
  return {
    allow_partial_enrollment: Boolean(obj.allow_partial_enrollment),
    min_percent_to_enroll:
      obj.min_percent_to_enroll != null ? Number(obj.min_percent_to_enroll) : null,
    min_amount_to_enroll:
      typeof obj.min_amount_to_enroll === "string" && obj.min_amount_to_enroll.trim()
        ? obj.min_amount_to_enroll
        : null,
    require_interview_fee_before_submit: Boolean(obj.require_interview_fee_before_submit),
  };
}

export function PolicyPage({ nav, activeHref }: Props) {
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Local form state (strings for controlled inputs)
  const [minPercent, setMinPercent] = useState("");
  const [minAmount, setMinAmount] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const body = await apiFetch<unknown>("/tenants/director/finance/setup", {
        tenantRequired: true,
      });
      const obj = asObject(body) ?? {};
      const p = normalizePolicy(obj.policy);
      setPolicy(p);
      setMinPercent(p.min_percent_to_enroll != null ? String(p.min_percent_to_enroll) : "");
      setMinAmount(p.min_amount_to_enroll ?? "");
    } catch {
      toast.error("Failed to load finance policy.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const payload: Policy = {
        ...policy,
        min_percent_to_enroll:
          policy.allow_partial_enrollment && minPercent.trim()
            ? Number(minPercent)
            : null,
        min_amount_to_enroll:
          policy.allow_partial_enrollment && minAmount.trim()
            ? minAmount.trim()
            : null,
      };

      await apiFetch<Policy>("/tenants/director/finance/policy", {
        method: "PUT",
        tenantRequired: true,
        body: JSON.stringify(payload),
      });

      setPolicy(payload);
      toast.success("Finance policy saved.");
    } catch (err: unknown) {
      toast.error(readApiError(err, "Failed to save policy."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Director" nav={nav} activeHref={activeHref}>
        <div className="flex min-h-[380px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading policy…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Director" nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        <TenantPageHeader
          title="Finance Policy"
          description="Configure enrollment payment requirements and fee collection rules for this school."
          badges={[{ label: "Finance Setup" }]}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          }
        />

        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
            <ShieldCheck className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Enrollment Payment Rules</h2>
          </div>

          <div className="space-y-6 px-6 py-6">
            {/* Interview fee requirement */}
            <div className="flex items-start justify-between gap-6 rounded-xl border border-slate-100 p-4">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Require interview fee before application submit
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  When enabled, applicants must pay the interview fee before their enrollment
                  application is submitted for review.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={policy.require_interview_fee_before_submit}
                onClick={() =>
                  setPolicy((p) => ({
                    ...p,
                    require_interview_fee_before_submit: !p.require_interview_fee_before_submit,
                  }))
                }
                className={`relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  policy.require_interview_fee_before_submit ? "bg-blue-600" : "bg-slate-200"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    policy.require_interview_fee_before_submit ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Allow partial enrollment */}
            <div className="space-y-4 rounded-xl border border-slate-100 p-4">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    Allow partial payment at enrollment
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    When enabled, students can complete enrollment by paying only a portion of
                    their fees. Optionally set a minimum threshold.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={policy.allow_partial_enrollment}
                  onClick={() =>
                    setPolicy((p) => ({
                      ...p,
                      allow_partial_enrollment: !p.allow_partial_enrollment,
                    }))
                  }
                  className={`relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    policy.allow_partial_enrollment ? "bg-blue-600" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      policy.allow_partial_enrollment ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {policy.allow_partial_enrollment && (
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Minimum % to enroll{" "}
                      <span className="text-slate-400">(optional)</span>
                    </Label>
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="e.g. 50"
                        value={minPercent}
                        onChange={(e) => setMinPercent(e.target.value)}
                        className="pr-8"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                        %
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Student must have paid at least this percentage.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Minimum amount to enroll (KES){" "}
                      <span className="text-slate-400">(optional)</span>
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="e.g. 10000"
                      value={minAmount}
                      onChange={(e) => setMinAmount(e.target.value)}
                    />
                    <p className="text-xs text-slate-400">
                      Student must have paid at least this fixed amount.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end border-t border-slate-100 px-6 py-4">
            <Button onClick={() => void save()} disabled={saving}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save Policy"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
