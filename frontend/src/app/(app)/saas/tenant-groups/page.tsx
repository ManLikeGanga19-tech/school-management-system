"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  X,
  Building2,
  Users,
  Check,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { SaasPageHeader } from "@/components/saas/page-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

type Campus = { id: string; name: string; slug: string };

type Group = {
  id: string;
  name: string;
  slug: string;
  billing_email: string | null;
  primary_contact: string | null;
  plan_code: string | null;
  plan_name: string | null;
  state: "active" | "grace" | "locked";
  period_end: string | null;
  grace_until: string | null;
  campus_count: number;
  campuses: Campus[];
};

type Plan = { code: string; name: string; is_active: boolean };
type TenantRow = { tenant_id: string; tenant_name: string; tenant_slug: string };

type GroupDraft = {
  name: string;
  slug: string;
  billing_email: string;
  primary_contact: string;
  plan_code: string;
  period_end: string;
};

const STATE_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  grace: "bg-amber-50 text-amber-700 ring-amber-200",
  locked: "bg-red-50 text-red-700 ring-red-200",
};

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

export default function TenantGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<Group | null>(null);
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [managing, setManaging] = useState<Group | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, p, t] = await Promise.all([
        apiFetch<Group[]>("/admin/tenant-groups", { tenantRequired: false } as never),
        apiFetch<Plan[]>("/admin/subscription-plans", { tenantRequired: false } as never),
        apiFetch<TenantRow[]>("/admin/tenant-plans", { tenantRequired: false } as never),
      ]);
      setGroups(Array.isArray(g) ? g : []);
      setPlans(Array.isArray(p) ? p : []);
      setTenants(Array.isArray(t) ? t : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load tenant groups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate() {
    setEditing(null);
    setDraft({
      name: "",
      slug: "",
      billing_email: "",
      primary_contact: "",
      plan_code: "",
      period_end: "",
    });
  }

  function startEdit(g: Group) {
    setEditing(g);
    setDraft({
      name: g.name,
      slug: g.slug,
      billing_email: g.billing_email || "",
      primary_contact: g.primary_contact || "",
      plan_code: g.plan_code || "",
      period_end: g.period_end || "",
    });
  }

  async function saveGroup() {
    if (!draft) return;
    if (!draft.name.trim() || (!editing && !draft.slug.trim())) {
      toast.error("Name and slug are required.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/admin/tenant-groups/${editing.id}`, {
          method: "PATCH",
          tenantRequired: false,
          body: JSON.stringify({
            name: draft.name.trim(),
            billing_email: draft.billing_email.trim() || null,
            primary_contact: draft.primary_contact.trim() || null,
            plan_code: draft.plan_code || null,
            period_end: draft.period_end || null,
          }),
          headers: { "Content-Type": "application/json" },
        } as never);
        toast.success("Group updated.");
      } else {
        await apiFetch("/admin/tenant-groups", {
          method: "POST",
          tenantRequired: false,
          body: JSON.stringify({
            name: draft.name.trim(),
            slug: draft.slug.trim().toLowerCase(),
            billing_email: draft.billing_email.trim() || null,
            primary_contact: draft.primary_contact.trim() || null,
          }),
          headers: { "Content-Type": "application/json" },
        } as never);
        toast.success("Group created.");
      }
      setDraft(null);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save group.");
    } finally {
      setSaving(false);
    }
  }

  async function removeGroup(g: Group) {
    if (!confirm(`Delete "${g.name}"? Its ${g.campus_count} campus(es) will be detached.`))
      return;
    try {
      await apiFetch(`/admin/tenant-groups/${g.id}`, {
        method: "DELETE",
        tenantRequired: false,
      } as never);
      toast.success("Group deleted.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete group.");
    }
  }

  async function attachCampus(groupId: string, tenantId: string) {
    try {
      const updated = await apiFetch<Group>(
        `/admin/tenant-groups/${groupId}/campuses/${tenantId}`,
        { method: "POST", tenantRequired: false } as never,
      );
      setManaging(updated);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to attach campus.");
    }
  }

  async function detachCampus(groupId: string, tenantId: string) {
    try {
      const updated = await apiFetch<Group>(
        `/admin/tenant-groups/${groupId}/campuses/${tenantId}`,
        { method: "DELETE", tenantRequired: false } as never,
      );
      setManaging(updated);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to detach campus.");
    }
  }

  const managedCampusIds = new Set((managing?.campuses ?? []).map((c) => c.id));

  return (
    <AppShell title="SaaS" nav={saasNav} activeHref="/saas/tenant-groups">
      <SaasPageHeader
        title="Tenant Groups"
        description="Multi-campus Enterprise customers. A group's tier is shared by every campus under it."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={startCreate}>
              <Plus className="h-4 w-4" /> New Group
            </Button>
          </div>
        }
      />

      <section className="mt-2">
        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-slate-100 bg-white py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
            No tenant groups yet — create one for a multi-campus customer.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {groups.map((g) => (
              <div
                key={g.id}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-slate-800">
                      {g.name}
                    </h3>
                    <p className="font-mono text-xs text-slate-400">{g.slug}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => startEdit(g)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="Edit group"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => void removeGroup(g)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete group"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    {g.plan_name ?? "No tier"}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${
                      STATE_STYLES[g.state] ?? STATE_STYLES.active
                    }`}
                  >
                    {g.state}
                  </span>
                  {g.period_end && (
                    <span className="text-xs text-slate-400">
                      expires {formatDate(g.period_end)}
                    </span>
                  )}
                </div>

                <div className="mt-4 flex-1 rounded-lg bg-slate-50 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    <Building2 className="h-3.5 w-3.5" />
                    {g.campus_count} campus{g.campus_count === 1 ? "" : "es"}
                  </div>
                  {g.campuses.length === 0 ? (
                    <p className="text-xs text-slate-400">No campuses attached.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {g.campuses.map((c) => (
                        <span
                          key={c.id}
                          className="rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200"
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full"
                  onClick={() => setManaging(g)}
                >
                  <Users className="h-4 w-4" /> Manage campuses
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Group editor modal ─────────────────────────────────────────── */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">
                {editing ? `Edit ${editing.name}` : "New Tenant Group"}
              </h2>
              <button
                onClick={() => setDraft(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <Label className="text-xs">Group name</Label>
                <Input
                  value={draft.name}
                  placeholder="e.g. Riverside Schools Group"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              {!editing && (
                <div>
                  <Label className="text-xs">Slug</Label>
                  <Input
                    value={draft.slug}
                    placeholder="e.g. riverside-group"
                    onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Billing email</Label>
                  <Input
                    value={draft.billing_email}
                    onChange={(e) => setDraft({ ...draft, billing_email: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Primary contact</Label>
                  <Input
                    value={draft.primary_contact}
                    onChange={(e) => setDraft({ ...draft, primary_contact: e.target.value })}
                  />
                </div>
              </div>
              {editing && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Tier (shared by all campuses)</Label>
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
                            {p.name}
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
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void saveGroup()} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create group"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Campus manager modal ───────────────────────────────────────── */}
      {managing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="truncate text-sm font-semibold text-slate-800">
                Campuses · {managing.name}
              </h2>
              <button
                onClick={() => setManaging(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Attached campuses
                </p>
                {managing.campuses.length === 0 ? (
                  <p className="text-xs text-slate-400">None yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {managing.campuses.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-700">{c.name}</p>
                          <p className="font-mono text-[11px] text-slate-400">{c.slug}</p>
                        </div>
                        <button
                          onClick={() => void detachCampus(managing.id, c.id)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Detach campus"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Add a campus
                </p>
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {tenants
                    .filter((t) => !managedCampusIds.has(t.tenant_id))
                    .map((t) => (
                      <button
                        key={t.tenant_id}
                        onClick={() => void attachCampus(managing.id, t.tenant_id)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-700">{t.tenant_name}</p>
                          <p className="font-mono text-[11px] text-slate-400">
                            {t.tenant_slug}
                          </p>
                        </div>
                        <Check className="h-4 w-4 shrink-0 text-teal-500" />
                      </button>
                    ))}
                  {tenants.filter((t) => !managedCampusIds.has(t.tenant_id)).length === 0 && (
                    <p className="text-xs text-slate-400">All tenants are attached.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end border-t border-slate-100 px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setManaging(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
