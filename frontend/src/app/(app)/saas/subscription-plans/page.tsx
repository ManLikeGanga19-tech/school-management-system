"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
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

export default function SubscriptionPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, m] = await Promise.all([
        apiFetch<Plan[]>("/admin/subscription-plans", { tenantRequired: false } as never),
        apiFetch<ModuleOption[]>("/admin/modules", { tenantRequired: false } as never),
      ]);
      setPlans(Array.isArray(p) ? p : []);
      setModules(Array.isArray(m) ? m : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load plans.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        description="Define tiers and the modules each one unlocks. Core modules are always available."
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

      <SaasSurface>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : plans.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">
            No plans yet. Create the first tier.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3">Modules</th>
                  <th className="py-2 pr-3 text-right">Price (KES)</th>
                  <th className="py-2 pr-3 text-right">Grace</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-800">{p.name}</div>
                      <div className="font-mono text-xs text-slate-400">{p.code}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {p.modules.length === 0 ? (
                        <span className="text-xs text-slate-400">Core only</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {p.modules.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {p.price_kes.toLocaleString("en-KE")}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{p.grace_days}d</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          p.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {p.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => startEdit(p)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                          title="Edit plan"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void remove(p)}
                          className="rounded p-1.5 text-red-500 hover:bg-red-50"
                          title="Delete plan"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SaasSurface>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">
                {editing ? `Edit ${editing.name}` : "New Plan"}
              </h2>
              <button onClick={closeEditor} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Code</Label>
                  <Input
                    value={draft.code}
                    disabled={!!editing}
                    placeholder="e.g. standard"
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={draft.name}
                    placeholder="e.g. Standard"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Unlocked modules</Label>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  {modules.map((m) => (
                    <label
                      key={m.code}
                      className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={draft.modules.includes(m.code)}
                        onChange={() => toggleModule(m.code)}
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Core modules (finance, students, dashboard…) are always available.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
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

              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label className="text-xs">Billing cycle</Label>
                  <select
                    value={draft.billing_cycle}
                    onChange={(e) => setDraft({ ...draft, billing_cycle: e.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  >
                    <option value="per_term">Per term</option>
                    <option value="full_year">Full year</option>
                  </select>
                </div>
                <label className="mt-5 flex items-center gap-2 text-sm">
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
    </AppShell>
  );
}
