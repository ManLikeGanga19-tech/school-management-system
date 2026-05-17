"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  X,
  Layers,
  Building2,
  CheckCircle2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { SaasPageHeader } from "@/components/saas/page-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

type Plan = {
  id: string;
  code: string;
  name: string;
  modules: string[];
  price_kes: number;
  billing_cycle: string;
  grace_days: number;
  is_active: boolean;
  sort_order: number;
};

type ModuleOption = { code: string; label: string };

type TenantPlan = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  plan_code: string | null;
  plan_name: string | null;
  state: "active" | "grace" | "locked";
  period_end: string | null;
  grace_until: string | null;
};

type Draft = {
  code: string;
  name: string;
  modules: string[];
  price_kes: string;
  billing_cycle: string;
  grace_days: string;
  sort_order: string;
  is_active: boolean;
};

const EMPTY_DRAFT: Draft = {
  code: "",
  name: "",
  modules: [],
  price_kes: "0",
  billing_cycle: "per_term",
  grace_days: "14",
  sort_order: "0",
  is_active: true,
};

function formatPrice(kes: number, cycle: string): string {
  if (!kes || kes <= 0) return "Custom";
  const suffix = cycle === "per_year" ? "/yr" : "/term";
  return `KES ${kes.toLocaleString("en-KE")}${suffix}`;
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

const STATE_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  grace: "bg-amber-50 text-amber-700 ring-amber-200",
  locked: "bg-red-50 text-red-700 ring-red-200",
};

export default function SubscriptionPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [tenantPlans, setTenantPlans] = useState<TenantPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [assigning, setAssigning] = useState<TenantPlan | null>(null);
  const [assignDraft, setAssignDraft] = useState<{ plan_code: string; period_end: string }>({
    plan_code: "",
    period_end: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, m, tp] = await Promise.all([
        apiFetch<Plan[]>("/admin/subscription-plans", { tenantRequired: false } as never),
        apiFetch<ModuleOption[]>("/admin/modules", { tenantRequired: false } as never),
        apiFetch<TenantPlan[]>("/admin/tenant-plans", { tenantRequired: false } as never),
      ]);
      setPlans(Array.isArray(p) ? p : []);
      setModules(Array.isArray(m) ? m : []);
      setTenantPlans(Array.isArray(tp) ? tp : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load plans.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const moduleLabel = (code: string) =>
    modules.find((m) => m.code === code)?.label ?? code;

  function startCreate() {
    setEditing(null);
    setDraft({ ...EMPTY_DRAFT });
  }

  function startEdit(plan: Plan) {
    setEditing(plan);
    setDraft({
      code: plan.code,
      name: plan.name,
      modules: [...plan.modules],
      price_kes: String(plan.price_kes),
      billing_cycle: plan.billing_cycle,
      grace_days: String(plan.grace_days),
      sort_order: String(plan.sort_order),
      is_active: plan.is_active,
    });
  }

  function closeEditor() {
    setEditing(null);
    setDraft(null);
  }

  function toggleModule(code: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            modules: d.modules.includes(code)
              ? d.modules.filter((c) => c !== code)
              : [...d.modules, code],
          }
        : d,
    );
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || (!editing && !draft.code.trim())) {
      toast.error("Code and name are required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        modules: draft.modules,
        price_kes: Number(draft.price_kes) || 0,
        billing_cycle: draft.billing_cycle,
        grace_days: Number(draft.grace_days) || 0,
        sort_order: Number(draft.sort_order) || 0,
        is_active: draft.is_active,
      };
      if (editing) {
        await apiFetch(`/admin/subscription-plans/${editing.id}`, {
          method: "PATCH",
          tenantRequired: false,
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        } as never);
        toast.success("Plan updated.");
      } else {
        await apiFetch("/admin/subscription-plans", {
          method: "POST",
          tenantRequired: false,
          body: JSON.stringify({ ...body, code: draft.code.trim().toLowerCase() }),
          headers: { "Content-Type": "application/json" },
        } as never);
        toast.success("Plan created.");
      }
      closeEditor();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save plan.");
    } finally {
      setSaving(false);
    }
  }

  function startAssign(tp: TenantPlan) {
    setAssigning(tp);
    setAssignDraft({ plan_code: tp.plan_code || "", period_end: tp.period_end || "" });
  }

  async function saveAssignment() {
    if (!assigning) return;
    setSaving(true);
    try {
      await apiFetch(`/admin/tenant-plans/${assigning.tenant_id}`, {
        method: "PUT",
        tenantRequired: false,
        body: JSON.stringify({
          plan_code: assignDraft.plan_code || null,
          period_end: assignDraft.period_end || null,
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

  async function remove(plan: Plan) {
    if (!confirm(`Delete the "${plan.name}" plan? This cannot be undone.`)) return;
    try {
      await apiFetch(`/admin/subscription-plans/${plan.id}`, {
        method: "DELETE",
        tenantRequired: false,
      } as never);
      toast.success("Plan deleted.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete plan.");
    }
  }

  return (
    <AppShell title="SaaS" nav={saasNav} activeHref="/saas/subscription-plans">
      <SaasPageHeader
        title="Subscription Plans"
        description="The tier catalogue — define what each plan costs and unlocks, and assign tiers to tenants. Core modules (finance, students, dashboard) are always available."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={startCreate}>
              <Plus className="h-4 w-4" /> New Plan
            </Button>
          </div>
        }
      />

      {/* ── Plan catalogue ─────────────────────────────────────────────── */}
      <section className="mt-2">
        <div className="mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Plan Catalogue</h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-slate-100 bg-white py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
            No plans yet — create the first tier.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.id}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-slate-800">
                        {p.name}
                      </h3>
                      {!p.is_active && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-slate-400">{p.code}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => startEdit(p)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="Edit plan"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => void remove(p)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete plan"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <p className="mt-3 text-xl font-bold tracking-tight text-slate-900">
                  {formatPrice(p.price_kes, p.billing_cycle)}
                </p>

                <div className="mt-4 flex-1">
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Unlocked modules
                  </p>
                  {p.modules.length === 0 ? (
                    <p className="text-xs text-slate-400">Core modules only</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {p.modules.map((m) => (
                        <span
                          key={m}
                          className="rounded-md bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700"
                        >
                          {moduleLabel(m)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  Grace period: <span className="font-medium text-slate-700">{p.grace_days} days</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Tenant assignments ─────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Tenant Assignments</h2>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          A tenant with no tier keeps full access until one is assigned.
        </p>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-slate-100 bg-white py-12 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : tenantPlans.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-400">
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
                    {tp.plan_name || (
                      <span className="text-slate-400">No tier</span>
                    )}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${
                      STATE_STYLES[tp.state] ?? STATE_STYLES.active
                    }`}
                  >
                    {tp.state}
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
      </section>

      {/* ── Plan editor modal ──────────────────────────────────────────── */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">
                {editing ? `Edit ${editing.name}` : "New Plan"}
              </h2>
              <button onClick={closeEditor} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Code</Label>
                  <Input
                    value={draft.code}
                    disabled={!!editing}
                    placeholder="e.g. starter"
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={draft.name}
                    placeholder="e.g. Starter"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Unlocked modules</Label>
                <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {modules.map((m) => {
                    const on = draft.modules.includes(m.code);
                    return (
                      <button
                        key={m.code}
                        type="button"
                        onClick={() => toggleModule(m.code)}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition ${
                          on
                            ? "border-teal-300 bg-teal-50 text-teal-800"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <CheckCircle2
                          className={`h-4 w-4 shrink-0 ${on ? "text-teal-600" : "text-slate-300"}`}
                        />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Core modules (finance, students, dashboard…) are always available.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Price (KES)</Label>
                  <Input
                    type="number"
                    value={draft.price_kes}
                    onChange={(e) => setDraft({ ...draft, price_kes: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Grace (days)</Label>
                  <Input
                    type="number"
                    value={draft.grace_days}
                    onChange={(e) => setDraft({ ...draft, grace_days: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Sort order</Label>
                  <Input
                    type="number"
                    value={draft.sort_order}
                    onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[160px]">
                  <Label className="text-xs">Billing cycle</Label>
                  <select
                    value={draft.billing_cycle}
                    onChange={(e) => setDraft({ ...draft, billing_cycle: e.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  >
                    <option value="per_term">Per term</option>
                    <option value="per_year">Per year</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.is_active}
                    onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                  />
                  Active
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button variant="outline" size="sm" onClick={closeEditor}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create plan"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tenant assignment modal ────────────────────────────────────── */}
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
                  value={assignDraft.plan_code}
                  onChange={(e) => setAssignDraft({ ...assignDraft, plan_code: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                >
                  <option value="">No tier — full access</option>
                  {plans
                    .filter((p) => p.is_active || p.code === assignDraft.plan_code)
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
                  value={assignDraft.period_end}
                  onChange={(e) => setAssignDraft({ ...assignDraft, period_end: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  After this date the tenant enters the grace window, then becomes
                  read-only. Leave blank for an open-ended subscription.
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
    </AppShell>
  );
}
