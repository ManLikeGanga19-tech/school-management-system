"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import type { PermissionRow } from "@/lib/admin/rbac";
import { createPermission, deletePermission, listPermissions, updatePermission } from "@/lib/admin/rbac";

function normalizeCode(code: string) {
  return code.trim();
}

export default function SaaSPermissionsPage() {
  const nav = useMemo(
    () => [
      { href: "/saas/dashboard", label: "SaaS Summary" },
      { href: "/saas/tenants", label: "Tenants" },
      { href: "/saas/rbac", label: "RBAC" },
      { href: "/saas/audit", label: "Audit Logs" },
    ],
    []
  );

  const [rows, setRows] = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");

  // Create dialog state
  const [openCreate, setOpenCreate] = useState(false);
  const [cCode, setCCode] = useState("");
  const [cName, setCName] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit dialog state
  const [openEdit, setOpenEdit] = useState(false);
  const [editRow, setEditRow] = useState<PermissionRow | null>(null);
  const [eName, setEName] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await listPermissions();
      setRows(data || []);
    } catch (e: any) {
      setErr(e?.message || "Couldn’t load permissions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((p) => {
      const hay = `${p.code} ${p.name || ""} ${p.description || ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q]);

  async function onCreate() {
    const code = normalizeCode(cCode);
    const name = cName.trim();
    const description = cDesc.trim();

    if (!code) return toast.error("Permission code is required");
    if (!name) return toast.error("Permission name is required");

    setCreating(true);
    try {
      await createPermission({ code, name, description: description || undefined });
      toast.success("Permission created");
      setOpenCreate(false);
      setCCode("");
      setCName("");
      setCDesc("");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create permission");
    } finally {
      setCreating(false);
    }
  }

  function openEditFor(row: PermissionRow) {
    setEditRow(row);
    setEName(row.name || "");
    setEDesc(row.description || "");
    setOpenEdit(true);
  }

  async function onSaveEdit() {
    if (!editRow) return;

    const name = eName.trim();
    const description = eDesc.trim();

    if (!name) return toast.error("Permission name is required");

    setSaving(true);
    try {
      await updatePermission(editRow.code, {
        name,
        description: description || undefined,
      });
      toast.success("Permission updated");
      setOpenEdit(false);
      setEditRow(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update permission");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(code: string) {
    try {
      await deletePermission(code);
      toast.success("Permission deleted");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete permission");
    }
  }

  return (
    <AppShell title="Super Admin" nav={nav} activeHref="/saas/rbac">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Permissions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Canonical permission catalog used across the platform.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            Refresh
          </Button>

          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button>Create permission</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create permission</DialogTitle>
                <DialogDescription>
                  Use consistent dot notation (e.g. <code>rbac.roles.manage</code>).
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Code</div>
                  <Input
                    placeholder="e.g. tenants.read_all"
                    value={cCode}
                    onChange={(e) => setCCode(e.target.value)}
                  />
                  <div className="text-xs text-muted-foreground">
                    Must be unique. Used directly by tokens and checks.
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Name</div>
                  <Input
                    placeholder="Human friendly label"
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Description (optional)</div>
                  <Textarea
                    placeholder="What does this allow?"
                    value={cDesc}
                    onChange={(e) => setCDesc(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenCreate(false)} disabled={creating}>
                  Cancel
                </Button>
                <Button onClick={onCreate} disabled={creating}>
                  {creating ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="mt-6 rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Search</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Input
            placeholder="Search by code, name, or description…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="sm:max-w-md"
          />
          <div className="text-sm text-muted-foreground">
            Showing <span className="font-medium text-foreground">{filtered.length}</span> of{" "}
            <span className="font-medium text-foreground">{rows.length}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Permission list</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {err && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {err}
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground">No permissions match your search.</div>
          )}

          {!loading &&
            filtered.map((p) => (
              <div key={p.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-medium">{p.code}</code>
                      <Badge variant="secondary" className="rounded-full">
                        permission
                      </Badge>
                    </div>
                    <div className="mt-1 font-medium truncate">{p.name}</div>
                    {p.description ? (
                      <div className="text-sm text-muted-foreground mt-1">{p.description}</div>
                    ) : (
                      <div className="text-sm text-muted-foreground mt-1">—</div>
                    )}
                  </div>

                  <div className="flex gap-2 sm:justify-end">
                    <Button variant="outline" onClick={() => openEditFor(p)}>
                      Edit
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive">Delete</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete permission?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the permission and cascade via role mappings/overrides. Use with care.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete(p.code)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <Separator className="my-3" />

                <div className="text-xs text-muted-foreground">
                  ID: <code>{p.id}</code>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit permission</DialogTitle>
            <DialogDescription>
              Code is immutable: <code className="text-foreground">{editRow?.code || ""}</code>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Name</div>
              <Input value={eName} onChange={(e) => setEName(e.target.value)} />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Description</div>
              <Textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenEdit(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSaveEdit} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}