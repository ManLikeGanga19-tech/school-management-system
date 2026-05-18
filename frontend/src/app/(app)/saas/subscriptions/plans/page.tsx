"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Loader2, X, CheckCircle2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
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

function formatPrice(kes: number, cycle: string): string {
  if (!kes || kes <= 0) return "Custom";
  return `KES ${kes.toLocaleString("en-KE")}${cycle === "per_year" ? "/yr" : "/term"}`;
}

export default function PlansTab() {
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

  const moduleLabel = (code: string) => modules.find((m) => m.code === code)?.label ?? code;

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
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Plan Catalogue</h1>
          <p className="text-sm text-slate-500">
            Define what each tier costs and unlocks. Core modules are always available.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4" /> New Plan
          </Button>
        </div>
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
                    <h3 className="truncate text-base font-semibold text-slate-800">{p.name}</h3>
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
                Grace period:{" "}
                <span className="font-medium text-slate-700">{p.grace_days} days</span>
              </div>
            </div>
          ))}
        </div>
      )}

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
                <div className="min-w-[160px] flex-1">
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
    </div>
  );
}
