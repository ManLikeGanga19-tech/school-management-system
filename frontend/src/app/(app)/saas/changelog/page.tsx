"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Loader2, X, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { SaasPageHeader } from "@/components/saas/page-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

type Entry = {
  id: string;
  title: string;
  body: string;
  category: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string | null;
};

type Draft = {
  title: string;
  body: string;
  category: string;
  is_published: boolean;
};

const EMPTY: Draft = { title: "", body: "", category: "new", is_published: false };

const CATEGORY: Record<string, string> = {
  new: "bg-teal-100 text-teal-700",
  improved: "bg-blue-100 text-blue-700",
  fixed: "bg-slate-200 text-slate-600",
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

export default function ChangelogAdminPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch<Entry[]>("/admin/changelog", {
        tenantRequired: false,
      } as never);
      setEntries(Array.isArray(d) ? d : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load the changelog.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate() {
    setEditing(null);
    setDraft({ ...EMPTY });
  }

  function startEdit(e: Entry) {
    setEditing(e);
    setDraft({
      title: e.title,
      body: e.body,
      category: e.category,
      is_published: e.is_published,
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.title.trim() || !draft.body.trim()) {
      toast.error("Title and body are required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: draft.title.trim(),
        body: draft.body.trim(),
        category: draft.category,
        is_published: draft.is_published,
      };
      if (editing) {
        await apiFetch(`/admin/changelog/${editing.id}`, {
          method: "PATCH",
          tenantRequired: false,
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        } as never);
        toast.success("Update saved.");
      } else {
        await apiFetch("/admin/changelog", {
          method: "POST",
          tenantRequired: false,
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        } as never);
        toast.success("Update created.");
      }
      setDraft(null);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save the update.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(e: Entry) {
    if (!confirm(`Delete "${e.title}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/admin/changelog/${e.id}`, {
        method: "DELETE",
        tenantRequired: false,
      } as never);
      toast.success("Update deleted.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete the update.");
    }
  }

  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/changelog">
      <SaasPageHeader
        title="Changelog"
        description="Publish a 'What's New' note after each update — every tenant user sees it as a banner until they dismiss it."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={startCreate}>
              <Plus className="h-4 w-4" /> New Update
            </Button>
          </div>
        }
      />

      <section className="mt-2">
        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-slate-100 bg-white py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
            No updates yet — publish the first one.
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((e) => (
              <div
                key={e.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          CATEGORY[e.category] ?? CATEGORY.new
                        }`}
                      >
                        {e.category}
                      </span>
                      <span className="font-medium text-slate-800">{e.title}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          e.is_published
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {e.is_published ? `Published ${formatDate(e.published_at)}` : "Draft"}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-slate-500">
                      {e.body}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => startEdit(e)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => void remove(e)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Sparkles className="h-4 w-4 text-teal-600" />
                {editing ? "Edit update" : "New update"}
              </h2>
              <button onClick={() => setDraft(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <Label className="text-xs">Title</Label>
                <Input
                  value={draft.title}
                  placeholder="e.g. Subscription tiers"
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">What it does / how to use it</Label>
                <textarea
                  value={draft.body}
                  rows={6}
                  placeholder="Explain the update in plain language for school staff…"
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="min-w-[140px] flex-1">
                  <Label className="text-xs">Category</Label>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                  >
                    <option value="new">New</option>
                    <option value="improved">Improved</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.is_published}
                    onChange={(e) => setDraft({ ...draft, is_published: e.target.checked })}
                  />
                  Publish now
                </label>
              </div>
              <p className="text-[11px] text-slate-400">
                Publishing notifies every tenant user with a banner. Leave unpublished
                to keep it as a draft.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
