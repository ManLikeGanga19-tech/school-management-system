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
import { normalizeSubjects, type TenantSubject } from "@/lib/hr";

type SubjectsSetupPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type SubjectDraft = {
  code: string;
  name: string;
  is_active: boolean;
};

export function SubjectsSetupPage({ appTitle, nav, activeHref }: SubjectsSetupPageProps) {
  const [rows, setRows] = useState<TenantSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [form, setForm] = useState<SubjectDraft>({
    code: "",
    name: "",
    is_active: true,
  });
  const [editing, setEditing] = useState<Record<string, SubjectDraft>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<unknown>("/tenants/subjects?include_inactive=true", {
        tenantRequired: true,
        noRedirect: true,
      });
      setRows(normalizeSubjects(data));
    } catch (err: any) {
      setRows([]);
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to load tenant subjects"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createSubject() {
    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    if (!code || !name) {
      toast.error("Subject code and name are required.");
      return;
    }

    setSaving(true);
    try {
      await api.post(
        "/tenants/subjects",
        { code, name, is_active: form.is_active },
        { tenantRequired: true }
      );
      toast.success("Subject created successfully.");
      setForm({ code: "", name: "", is_active: true });
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string" ? err.message : "Failed to create subject"
      );
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: TenantSubject) {
    setEditing((prev) => ({
      ...prev,
      [row.id]: {
        code: row.code,
        name: row.name,
        is_active: row.is_active !== false,
      },
    }));
  }

  async function saveEdit(subjectId: string) {
    const draft = editing[subjectId];
    if (!draft) return;
    const code = draft.code.trim().toUpperCase();
    const name = draft.name.trim();
    if (!code || !name) {
      toast.error("Subject code and name are required.");
      return;
    }

    setUpdatingId(subjectId);
    try {
      await api.put(
        `/tenants/subjects/${subjectId}`,
        { code, name, is_active: draft.is_active },
        { tenantRequired: true }
      );
      toast.success("Subject updated.");
      setEditing((prev) => {
        const next = { ...prev };
        delete next[subjectId];
        return next;
      });
      await load();
    } catch (err: any) {
      toast.error(
        typeof err?.message === "string" ? err.message : "Failed to update subject"
      );
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">School Setup · Subjects</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Configure subjects used for teacher assignment and class delivery planning.
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

        <div className="dashboard-surface rounded-[1.6rem] p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Create Subject</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Add a subject code once and use it in teacher-to-class assignment workflows.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Code</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="MATH"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Mathematics"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={form.is_active ? "active" : "inactive"}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, is_active: value === "active" }))
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
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={() => void createSubject()} disabled={saving}>
              {saving ? "Saving..." : "Create Subject"}
            </Button>
          </div>
        </div>

        <div className="dashboard-surface rounded-[1.6rem]">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Subject Directory</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Subject setup shared across director and secretary operational modules.
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Code</TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {editing[row.id] ? (
                        <Input
                          value={editing[row.id].code}
                          onChange={(e) =>
                            setEditing((prev) => ({
                              ...prev,
                              [row.id]: { ...prev[row.id], code: e.target.value },
                            }))
                          }
                        />
                      ) : (
                        row.code
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-slate-900">
                      {editing[row.id] ? (
                        <Input
                          value={editing[row.id].name}
                          onChange={(e) =>
                            setEditing((prev) => ({
                              ...prev,
                              [row.id]: { ...prev[row.id], name: e.target.value },
                            }))
                          }
                        />
                      ) : (
                        row.name
                      )}
                    </TableCell>
                    <TableCell>
                      {editing[row.id] ? (
                        <Select
                          value={editing[row.id].is_active ? "active" : "inactive"}
                          onValueChange={(value) =>
                            setEditing((prev) => ({
                              ...prev,
                              [row.id]: { ...prev[row.id], is_active: value === "active" },
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span
                          className={
                            row.is_active
                              ? "text-xs font-medium text-emerald-700"
                              : "text-xs font-medium text-slate-500"
                          }
                        >
                          {row.is_active ? "Active" : "Inactive"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editing[row.id] ? (
                        <div className="inline-flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setEditing((prev) => {
                                const next = { ...prev };
                                delete next[row.id];
                                return next;
                              })
                            }
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void saveEdit(row.id)}
                            disabled={updatingId === row.id}
                          >
                            {updatingId === row.id ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => startEdit(row)}>
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    No subjects configured yet.
                  </TableCell>
                </TableRow>
              )}

              {loading && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    Loading subjects...
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
