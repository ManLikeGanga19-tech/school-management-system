"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  normalizeTerms,
  type TenantTerm,
} from "@/lib/school-setup/terms";

type TermsSetupPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

export function TermsSetupPage({ appTitle, nav, activeHref }: TermsSetupPageProps) {
  const [terms, setTerms] = useState<TenantTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    start_date: "",
    end_date: "",
    is_active: true,
  });
  const [editing, setEditing] = useState<Record<string, {
    code: string;
    name: string;
    start_date: string;
    end_date: string;
    is_active: boolean;
  }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<unknown>("/tenants/terms?include_inactive=true", {
        tenantRequired: true,
        noRedirect: true,
      });
      const normalized = normalizeTerms(data);
      setTerms(normalized);
      setFallbackUsed(false);
    } catch {
      setTerms([]);
      setFallbackUsed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTerm() {
    if (fallbackUsed) {
      toast.error("Terms storage is unavailable. Run backend migrations and retry.");
      return;
    }

    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    if (!code || !name) {
      toast.error("Term code and name are required.");
      return;
    }

    setSaving(true);
    try {
      await api.post(
        "/tenants/terms",
        {
          code,
          name,
          is_active: form.is_active,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
        },
        { tenantRequired: true }
      );
      toast.success("Term created successfully.");
      setForm({
        code: "",
        name: "",
        start_date: "",
        end_date: "",
        is_active: true,
      });
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to create term");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(term: TenantTerm) {
    setEditing((prev) => ({
      ...prev,
      [term.id]: {
        code: term.code,
        name: term.name,
        start_date: term.start_date ?? "",
        end_date: term.end_date ?? "",
        is_active: term.is_active !== false,
      },
    }));
  }

  async function saveEdit(termId: string) {
    if (fallbackUsed) {
      toast.error("Terms storage is unavailable. Run backend migrations and retry.");
      return;
    }

    const draft = editing[termId];
    if (!draft) return;
    const code = draft.code.trim().toUpperCase();
    const name = draft.name.trim();
    if (!code || !name) {
      toast.error("Term code and name are required.");
      return;
    }

    setUpdatingId(termId);
    try {
      await api.put(
        `/tenants/terms/${termId}`,
        {
          code,
          name,
          is_active: draft.is_active,
          start_date: draft.start_date || null,
          end_date: draft.end_date || null,
        },
        { tenantRequired: true }
      );
      toast.success("Term updated.");
      setEditing((prev) => {
        const next = { ...prev };
        delete next[termId];
        return next;
      });
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to update term");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">School Setup · Terms</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Manage academic terms used across intake, finance, and reports.
              </p>
            </div>
            <Button
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void load()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {fallbackUsed && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Terms storage is unavailable. Run backend migrations to enable persistent terms.
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Create Term</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Add a new academic term for tenant enrollment workflows.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs">Code</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                placeholder="T1-2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Term 1 (2026)"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Start Date</Label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End Date</Label>
              <Input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={form.is_active ? "active" : "inactive"}
                onValueChange={(v) => setForm((p) => ({ ...p, is_active: v === "active" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={() => void createTerm()} disabled={saving || fallbackUsed}>
              {saving ? "Saving…" : "Create Term"}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Term Directory</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Current options available for enrollment term selection.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Code</TableHead>
                <TableHead className="text-xs">Start</TableHead>
                <TableHead className="text-xs">End</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                terms.map((term) => (
                  <TableRow key={term.id}>
                    <TableCell className="text-sm font-medium text-slate-900">
                      {editing[term.id] ? (
                        <Input
                          value={editing[term.id].name}
                          onChange={(e) =>
                            setEditing((prev) => ({
                              ...prev,
                              [term.id]: { ...prev[term.id], name: e.target.value },
                            }))
                          }
                        />
                      ) : (
                        term.name
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {editing[term.id] ? (
                        <Input
                          value={editing[term.id].code}
                          onChange={(e) =>
                            setEditing((prev) => ({
                              ...prev,
                              [term.id]: { ...prev[term.id], code: e.target.value },
                            }))
                          }
                        />
                      ) : (
                        term.code
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {editing[term.id] ? (
                        <Input
                          type="date"
                          value={editing[term.id].start_date}
                          onChange={(e) =>
                            setEditing((prev) => ({
                              ...prev,
                              [term.id]: { ...prev[term.id], start_date: e.target.value },
                            }))
                          }
                        />
                      ) : (
                        term.start_date || "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {editing[term.id] ? (
                        <Input
                          type="date"
                          value={editing[term.id].end_date}
                          onChange={(e) =>
                            setEditing((prev) => ({
                              ...prev,
                              [term.id]: { ...prev[term.id], end_date: e.target.value },
                            }))
                          }
                        />
                      ) : (
                        term.end_date || "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {editing[term.id] ? (
                        <Select
                          value={editing[term.id].is_active ? "active" : "inactive"}
                          onValueChange={(v) =>
                            setEditing((prev) => ({
                              ...prev,
                              [term.id]: { ...prev[term.id], is_active: v === "active" },
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            term.is_active === false
                              ? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                              : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          }`}
                        >
                          {term.is_active === false ? "Inactive" : "Active"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editing[term.id] ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => void saveEdit(term.id)}
                            disabled={updatingId === term.id}
                          >
                            {updatingId === term.id ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setEditing((prev) => {
                                const next = { ...prev };
                                delete next[term.id];
                                return next;
                              })
                            }
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => startEdit(term)}>
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              {!loading && terms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">
                    No terms available.
                  </TableCell>
                </TableRow>
              )}
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">
                    Loading terms…
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppShell>
  );
}
