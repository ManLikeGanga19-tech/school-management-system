"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

type Plan = {
  code: string;
  name: string;
  price_kes: number;
  billing_cycle: string;
  is_active: boolean;
};

type TenantPlan = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  plan_code: string | null;
  plan_name: string | null;
  state: "active" | "grace" | "locked";
  state_override: string | null;
  period_end: string | null;
  grace_until: string | null;
};

const STATE_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  grace: "bg-amber-50 text-amber-700 ring-amber-200",
  locked: "bg-red-50 text-red-700 ring-red-200",
};

function formatPrice(kes: number, cycle: string): string {
  if (!kes || kes <= 0) return "Custom";
  return `KES ${kes.toLocaleString("en-KE")}${cycle === "per_year" ? "/yr" : "/term"}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-KE", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function TenantsTab() {
  const [tenantPlans, setTenantPlans] = useState<TenantPlan[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState<TenantPlan | null>(null);
  const [draft, setDraft] = useState<{
    plan_code: string;
    period_end: string;
    state_override: string;
  }>({ plan_code: "", period_end: "", state_override: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tp, p] = await Promise.all([
        apiFetch<TenantPlan[]>("/admin/tenant-plans", { tenantRequired: false } as never),
        apiFetch<Plan[]>("/admin/subscription-plans", { tenantRequired: false } as never),
      ]);
      setTenantPlans(Array.isArray(tp) ? tp : []);
      setPlans(Array.isArray(p) ? p : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load tenants.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startAssign(tp: TenantPlan) {
    setAssigning(tp);
    setDraft({
      plan_code: tp.plan_code || "",
      period_end: tp.period_end || "",
      state_override: tp.state_override || "",
    });
  }

  async function saveAssignment() {
    if (!assigning) return;
    setSaving(true);
    try {
      await apiFetch(`/admin/tenant-plans/${assigning.tenant_id}`, {
        method: "PUT",
        tenantRequired: false,
        body: JSON.stringify({
          plan_code: draft.plan_code || null,
          period_end: draft.period_end || null,
          state_override: draft.state_override || null,
        }),
        headers: { "Content-Type": "application/json" },
      } as never);
      toast.success("Tenant plan updated.");
      setAssigning(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update tenant plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Tenant Assignments</h1>
          <p className="text-sm text-slate-500">
            Assign a tier and expiry to each school. A tenant with no tier keeps full access.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-slate-100 bg-white py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : tenantPlans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
          No tenants yet.
        </div>
      ) : (
        <div className="space-y-2">
          {tenantPlans.map((tp) => (
            <div
              key={tp.tenant_id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{tp.tenant_name}</p>
                <p className="font-mono text-xs text-slate-400">{tp.tenant_slug}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="text-sm text-slate-600">
                  {tp.plan_name || <span className="text-slate-400">No tier</span>}
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${
                    STATE_STYLES[tp.state] ?? STATE_STYLES.active
                  }`}
                >
                  {tp.state}
                  {tp.state_override ? " · forced" : ""}
                </span>
                {tp.period_end && (
                  <span className="text-xs text-slate-400">
                    expires {formatDate(tp.period_end)}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startAssign(tp)}
                  className="ml-auto sm:ml-0"
                >
                  {tp.plan_code ? "Change" : "Assign"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {assigning && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="truncate text-sm font-semibold text-slate-800">
                Plan for {assigning.tenant_name}
              </h2>
              <button
                onClick={() => setAssigning(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <Label className="text-xs">Tier</Label>
                <select
                  value={draft.plan_code}
                  onChange={(e) => setDraft({ ...draft, plan_code: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                >
                  <option value="">No tier — full access</option>
                  {plans
                    .filter((p) => p.is_active || p.code === draft.plan_code)
                    .map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name} · {formatPrice(p.price_kes, p.billing_cycle)}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Expiry date</Label>
                <Input
                  type="date"
                  value={draft.period_end}
                  onChange={(e) => setDraft({ ...draft, period_end: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  After this date the tenant enters the grace window, then becomes read-only.
                  Leave blank for an open-ended subscription.
                </p>
              </div>
              <div>
                <Label className="text-xs">Lifecycle state</Label>
                <select
                  value={draft.state_override}
                  onChange={(e) => setDraft({ ...draft, state_override: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                >
                  <option value="">Auto — computed from the expiry date</option>
                  <option value="active">Force Active</option>
                  <option value="grace">Force Grace</option>
                  <option value="locked">Force Locked</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  A forced state overrides the expiry date — useful for testing or to
                  lock/extend a tenant immediately. Set to Auto for normal behaviour.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setAssigning(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void saveAssignment()} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
