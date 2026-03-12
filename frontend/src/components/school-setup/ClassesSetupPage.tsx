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

type TenantClass = {
  id: string;
  name: string;
  code: string;
  is_active?: boolean;
};

type ClassesSetupPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

export function ClassesSetupPage({ appTitle, nav, activeHref }: ClassesSetupPageProps) {
  const [rows, setRows] = useState<TenantClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    is_active: true,
  });
  const [editing, setEditing] = useState<Record<string, {
    code: string;
    name: string;
    is_active: boolean;
  }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<TenantClass[]>("/tenants/classes?include_inactive=true", {
        tenantRequired: true,
        noRedirect: true,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setRows([]);
      toast.error(
        typeof err?.message === "string"
          ? err.message
          : "Failed to load tenant classes"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createClass() {
    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    if (!code || !name) {
      toast.error("Class code and name are required.");
      return;
    }

    setSaving(true);
    try {
      await api.post(
        "/tenants/classes",
        { code, name, is_active: form.is_active },
        { tenantRequired: true }
      );
      toast.success("Class created successfully.");
      setForm({ code: "", name: "", is_active: true });
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to create class");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: TenantClass) {
    setEditing((prev) => ({
      ...prev,
      [row.id]: {
        code: row.code,
        name: row.name,
        is_active: row.is_active !== false,
      },
    }));
  }

  async function saveEdit(classId: string) {
    const draft = editing[classId];
    if (!draft) return;
    const code = draft.code.trim().toUpperCase();
    const name = draft.name.trim();
    if (!code || !name) {
      toast.error("Class code and name are required.");
      return;
    }

    setUpdatingId(classId);
    try {
      await api.put(
        `/tenants/classes/${classId}`,
        {
          code,
          name,
          is_active: draft.is_active,
        },
        { tenantRequired: true }
      );
      toast.success("Class updated.");
      setEditing((prev) => {
        const next = { ...prev };
        delete next[classId];
        return next;
      });
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to update class");
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
              <h1 className="text-xl font-bold">School Setup · Classes</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                View configured school classes used by intake and fee structures.
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
            <h2 className="text-sm font-semibold text-slate-900">Create Class</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Add a new class for admissions and fee-structure assignment.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Code</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                placeholder="GRADE_1"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Grade 1"
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
            <Button onClick={() => void createClass()} disabled={saving}>
              {saving ? "Saving…" : "Create Class"}
            </Button>
          </div>
        </div>

        <div className="dashboard-surface rounded-[1.6rem]">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Class Directory</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Active classes available in admission and enrollment workflows.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Code</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                rows.map((row) => (
                  <TableRow key={row.id}>
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
                    <TableCell className="font-mono text-xs text-slate-500">
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
                    <TableCell>
                      {editing[row.id] ? (
                        <Select
                          value={editing[row.id].is_active ? "active" : "inactive"}
                          onValueChange={(v) =>
                            setEditing((prev) => ({
                              ...prev,
                              [row.id]: { ...prev[row.id], is_active: v === "active" },
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
                            row.is_active === false
                              ? "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                              : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          }`}
                        >
                          {row.is_active === false ? "Inactive" : "Active"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editing[row.id] ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => void saveEdit(row.id)}
                            disabled={updatingId === row.id}
                          >
                            {updatingId === row.id ? "Saving…" : "Save"}
                          </Button>
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
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">
                    No classes configured for this tenant.
                  </TableCell>
                </TableRow>
              )}
              {loading && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-400">
                    Loading classes…
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
