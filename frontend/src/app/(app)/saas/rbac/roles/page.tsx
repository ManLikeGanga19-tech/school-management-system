"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RoleRow, PermissionRow } from "@/lib/admin/rbac";
import {
  createRole,
  deleteRole,
  getRolePermissions,
  listPermissions,
  listRoles,
  updateRole,
  addRolePermissions,
  removeRolePermissions,
} from "@/lib/admin/rbac";
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

// ✅ You need tenants in this page for enterprise UX (scope=tenant/all needs tenant_id)
type TenantRow = {
  id: string;
  slug: string;
  name: string;
  primary_domain?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

// local helper (keeps this file self-contained; uses your existing apiFetch)
import { apiFetch } from "@/lib/api";

async function listTenants(): Promise<TenantRow[]> {
  return apiFetch<TenantRow[]>("/api/v1/admin/tenants", {
    method: "GET",
    tenantRequired: false,
  });
}

function uniq(arr: string[]) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function toSet(arr: string[]) {
  return new Set((arr || []).filter(Boolean));
}

function setToArray(s: Set<string>) {
  return Array.from(s);
}

export default function SaaSRolesPage() {
  const nav = useMemo(
    () => [
      { href: "/saas/dashboard", label: "SaaS Summary" },
      { href: "/saas/tenants", label: "Tenants" },
      { href: "/saas/rbac", label: "RBAC" },
      { href: "/saas/audit", label: "Audit Logs" },
    ],
    []
  );

  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // ✅ enterprise: tenant selector inside roles page
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string>(""); // empty => none selected

  // ✅ default to global so we don't require tenant context
  const [scope, setScope] = useState<"tenant" | "global" | "all">("global");
  const [q, setQ] = useState("");

  // create dialog
  const [openCreate, setOpenCreate] = useState(false);
  const [cScope, setCScope] = useState<"tenant" | "global">("global");
  const [cCode, setCCode] = useState("");
  const [cName, setCName] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // inspect dialog
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectRole, setInspectRole] = useState<RoleRow | null>(null);
  const [inspectPerms, setInspectPerms] = useState<string[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  // edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleRow | null>(null);
  const [eName, setEName] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // ✅ manage permissions dialog (ENTERPRISE FIX)
  const [permOpen, setPermOpen] = useState(false);
  const [permRole, setPermRole] = useState<RoleRow | null>(null);
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState(false);
  const [permCatalog, setPermCatalog] = useState<PermissionRow[]>([]);
  const [permSearch, setPermSearch] = useState("");

  // baseAssigned = snapshot from backend at open time
  const [baseAssigned, setBaseAssigned] = useState<string[]>([]);
  // desiredAssigned = what user wants now
  const [desiredAssigned, setDesiredAssigned] = useState<string[]>([]);

  // ✅ load tenants once
  async function loadTenantsData() {
    setTenantsLoading(true);
    try {
      const data = await listTenants();
      setTenants(data || []);
      if (!tenantId) {
        const firstActive = (data || []).find((t) => t.is_active);
        if (firstActive) setTenantId(firstActive.id);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load tenants");
    } finally {
      setTenantsLoading(false);
    }
  }

  // ✅ roles loader (scope-aware)
  async function loadRoles(next?: { scope?: "tenant" | "global" | "all"; tenantId?: string }) {
    setLoading(true);
    setErr(null);

    const effectiveScope = next?.scope ?? scope;
    const effectiveTenantId = next?.tenantId ?? tenantId;

    try {
      if ((effectiveScope === "tenant" || effectiveScope === "all") && !effectiveTenantId) {
        setRows([]);
        setErr("Select a tenant to view tenant/all roles.");
        return;
      }

      const data = await listRoles(
        effectiveScope,
        { tenantId: effectiveTenantId || undefined } as any
      );

      setRows(data || []);
    } catch (e: any) {
      setErr(e?.message || "Couldn’t load roles");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTenantsData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reload roles whenever scope OR tenant changes
  useEffect(() => {
    loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, tenantId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((r) => {
      const hay = `${r.code} ${r.name || ""} ${r.description || ""} ${r.tenant_id || ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q]);

  async function onCreate() {
    const code = cCode.trim();
    const name = cName.trim();
    const description = cDesc.trim();

    if (!code) return toast.error("Role code is required");
    if (!name) return toast.error("Role name is required");

    if (cScope === "tenant" && !tenantId) {
      return toast.error("Select a tenant before creating a tenant-scoped role");
    }

    setCreating(true);
    try {
      await createRole({
        code,
        name,
        description: description || undefined,
        scope: cScope,
        tenantId: cScope === "tenant" ? tenantId : undefined,
      } as any);

      toast.success("Role created");
      setOpenCreate(false);
      setCCode("");
      setCName("");
      setCDesc("");

      if (cScope === "tenant" && scope === "global") {
        setScope("tenant");
      } else {
        await loadRoles();
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to create role");
    } finally {
      setCreating(false);
    }
  }

  async function openInspect(role: RoleRow) {
    setInspectRole(role);
    setInspectPerms([]);
    setInspectOpen(true);
    setInspectLoading(true);
    try {
      const res = await getRolePermissions(role.id);
      setInspectPerms(res.permissions || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load role permissions");
    } finally {
      setInspectLoading(false);
    }
  }

  function openEdit(role: RoleRow) {
    setEditRole(role);
    setEName(role.name || "");
    setEDesc(role.description || "");
    setEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editRole) return;

    const name = eName.trim();
    const description = eDesc.trim();
    if (!name) return toast.error("Role name is required");

    setSaving(true);
    try {
      await updateRole(editRole.id, { name, description: description || undefined });
      toast.success("Role updated");
      setEditOpen(false);
      setEditRole(null);
      await loadRoles();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update role");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(role: RoleRow) {
    if (role.is_system) return toast.error("System roles cannot be deleted");
    try {
      await deleteRole(role.id);
      toast.success("Role deleted");
      await loadRoles();
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete role");
    }
  }

  const selectedTenant = useMemo(
    () => tenants.find((t) => t.id === tenantId) || null,
    [tenants, tenantId]
  );

  // -------------------------
  // Manage Permissions (ENTERPRISE FIX)
  // -------------------------

  async function openManagePermissions(role: RoleRow) {
    setPermRole(role);
    setPermOpen(true);
    setPermSearch("");
    setPermCatalog([]);
    setBaseAssigned([]);
    setDesiredAssigned([]);
    setPermLoading(true);

    try {
      const [catalog, assigned] = await Promise.all([
        listPermissions(),
        getRolePermissions(role.id),
      ]);

      const base = uniq(assigned.permissions || []);
      setPermCatalog(catalog || []);
      setBaseAssigned(base);
      setDesiredAssigned(base); // start desired == base
    } catch (e: any) {
      toast.error(e?.message || "Failed to load permissions");
      setPermCatalog([]);
      setBaseAssigned([]);
      setDesiredAssigned([]);
    } finally {
      setPermLoading(false);
    }
  }

  const desiredSet = useMemo(() => toSet(desiredAssigned), [desiredAssigned]);
  const baseSet = useMemo(() => toSet(baseAssigned), [baseAssigned]);

  function isDesiredAssigned(code: string) {
    return desiredSet.has(code);
  }

  function toggleDesired(code: string) {
    setDesiredAssigned((prev) => {
      const s = new Set(prev);
      if (s.has(code)) s.delete(code);
      else s.add(code);
      return setToArray(s);
    });
  }

  const filteredPermCatalog = useMemo(() => {
    const needle = permSearch.trim().toLowerCase();
    const all = permCatalog || [];
    if (!needle) return all;
    return all.filter((p) => {
      const hay = `${p.code} ${p.name || ""} ${p.description || ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [permCatalog, permSearch]);

  // diffs (computed from sets => always correct)
  const diff = useMemo(() => {
    const toAdd: string[] = [];
    const toRemove: string[] = [];

    for (const c of desiredSet) if (!baseSet.has(c)) toAdd.push(c);
    for (const c of baseSet) if (!desiredSet.has(c)) toRemove.push(c);

    toAdd.sort();
    toRemove.sort();
    return { toAdd, toRemove };
  }, [baseSet, desiredSet]);

  async function saveManagePermissions() {
    if (!permRole) return;

    const toAdd = uniq(diff.toAdd);
    const toRemove = uniq(diff.toRemove);

    if (toAdd.length === 0 && toRemove.length === 0) {
      toast.message("No changes to save");
      setPermOpen(false);
      return;
    }

    setPermSaving(true);
    try {
      // apply additions first
      if (toAdd.length) await addRolePermissions(permRole.id, toAdd);
      if (toRemove.length) await removeRolePermissions(permRole.id, toRemove);

      toast.success("Role permissions updated");

      // refresh base/desired from backend to remain consistent
      const res = await getRolePermissions(permRole.id);
      const fresh = uniq(res.permissions || []);
      setBaseAssigned(fresh);
      setDesiredAssigned(fresh);

      setPermOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to update role permissions");
    } finally {
      setPermSaving(false);
    }
  }

  return (
    <AppShell title="Super Admin" nav={nav} activeHref="/saas/rbac">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Roles</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage role catalog, tenant scoping, and permission sets.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => loadRoles()} disabled={loading}>
            Refresh
          </Button>

          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button>Create role</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create role</DialogTitle>
                <DialogDescription>
                  Create a <b>global</b> role (platform-wide) or a <b>tenant</b> role (scoped).
                  {cScope === "tenant" && (
                    <>
                      {" "}
                      Tenant:{" "}
                      <code className="text-foreground">
                        {selectedTenant?.slug || "not selected"}
                      </code>
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Scope</div>
                  <Select value={cScope} onValueChange={(v: any) => setCScope(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">Global</SelectItem>
                      <SelectItem value="tenant">Tenant</SelectItem>
                    </SelectContent>
                  </Select>
                  {cScope === "tenant" && !tenantId && (
                    <div className="text-xs text-destructive">
                      Select a tenant in Filters before creating a tenant role.
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Code</div>
                  <Input
                    placeholder="e.g. SUPER_ADMIN"
                    value={cCode}
                    onChange={(e) => setCCode(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Name</div>
                  <Input
                    placeholder="e.g. Super Admin"
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Description (optional)</div>
                  <Textarea value={cDesc} onChange={(e) => setCDesc(e.target.value)} />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenCreate(false)} disabled={creating}>
                  Cancel
                </Button>
                <Button onClick={onCreate} disabled={creating || (cScope === "tenant" && !tenantId)}>
                  {creating ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="mt-6 rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={tenantId || "__none__"}
                onValueChange={(v: any) => setTenantId(v === "__none__" ? "" : v)}
                disabled={tenantsLoading}
              >
                <SelectTrigger className="sm:w-80">
                  <SelectValue
                    placeholder={
                      tenantsLoading ? "Loading tenants..." : "Select tenant (for tenant/all scopes)"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No tenant selected</SelectItem>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.slug}){t.is_active ? "" : " • inactive"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={scope} onValueChange={(v: any) => setScope(v)}>
                <SelectTrigger className="sm:w-44">
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="tenant">Tenant</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>

              <Input
                placeholder="Search by code, name, description…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="sm:w-96"
              />
            </div>

            <div className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filtered.length}</span> of{" "}
              <span className="font-medium text-foreground">{rows.length}</span>
            </div>
          </div>

          {(scope === "tenant" || scope === "all") && !tenantId && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <span className="font-medium">Tenant required:</span> select a tenant to view{" "}
              <code>{scope}</code> roles.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4 rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Role list</CardTitle>
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
            <div className="text-sm text-muted-foreground">No roles match your filters.</div>
          )}

          {!loading &&
            filtered.map((r) => (
              <div key={r.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-medium">{r.code}</code>
                      {r.tenant_id ? (
                        <Badge variant="secondary" className="rounded-full">
                          tenant
                        </Badge>
                      ) : (
                        <Badge className="rounded-full">global</Badge>
                      )}
                      {r.is_system && (
                        <Badge variant="outline" className="rounded-full">
                          system
                        </Badge>
                      )}
                    </div>

                    <div className="mt-1 font-medium truncate">{r.name}</div>

                    {r.description ? (
                      <div className="text-sm text-muted-foreground mt-1">{r.description}</div>
                    ) : (
                      <div className="text-sm text-muted-foreground mt-1">—</div>
                    )}

                    {r.tenant_id && (
                      <div className="text-xs text-muted-foreground mt-2">
                        tenant_id: <code>{r.tenant_id}</code>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Button variant="outline" onClick={() => openInspect(r)}>
                      Inspect
                    </Button>

                    <Button variant="outline" onClick={() => openManagePermissions(r)}>
                      Manage permissions
                    </Button>

                    <Button variant="outline" onClick={() => openEdit(r)}>
                      Edit
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={r.is_system}>
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete role?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This deletes the role. If it’s assigned to users, make sure you remove it first.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete(r)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <Separator className="my-3" />

                <div className="text-xs text-muted-foreground">
                  ID: <code>{r.id}</code>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      {/* Inspect dialog */}
      <Dialog open={inspectOpen} onOpenChange={setInspectOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Role permissions</DialogTitle>
            <DialogDescription>
              Role: <code className="text-foreground">{inspectRole?.code || ""}</code>
            </DialogDescription>
          </DialogHeader>

          {inspectLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="rounded-xl border p-3">
              {inspectPerms.length === 0 ? (
                <div className="text-sm text-muted-foreground">No permissions assigned to this role.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {inspectPerms.map((p) => (
                    <Badge key={p} variant="secondary" className="rounded-full">
                      {p}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setInspectOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage permissions dialog */}
      <Dialog open={permOpen} onOpenChange={setPermOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Manage role permissions</DialogTitle>
            <DialogDescription>
              Role: <code className="text-foreground">{permRole?.code || ""}</code>
            </DialogDescription>
          </DialogHeader>

          {permLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Input
                  placeholder="Search permissions by code/name/description…"
                  value={permSearch}
                  onChange={(e) => setPermSearch(e.target.value)}
                  className="sm:max-w-md"
                />

                <div className="text-sm text-muted-foreground">
                  Changes:{" "}
                  <span className="font-medium text-foreground">
                    +{diff.toAdd.length}
                  </span>{" "}
                  /{" "}
                  <span className="font-medium text-foreground">
                    -{diff.toRemove.length}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border p-3 max-h-[420px] overflow-auto">
                {filteredPermCatalog.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No permissions match your search.</div>
                ) : (
                  <div className="space-y-2">
                    {filteredPermCatalog.map((p) => {
                      const desired = isDesiredAssigned(p.code);
                      const originally = baseSet.has(p.code);
                      const changed = desired !== originally;

                      return (
                        <div
                          key={p.id}
                          className="flex items-start justify-between gap-3 rounded-lg border p-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <code className="text-sm font-medium">{p.code}</code>

                              {desired ? (
                                <Badge className="rounded-full">assigned</Badge>
                              ) : (
                                <Badge variant="secondary" className="rounded-full">
                                  not assigned
                                </Badge>
                              )}

                              {changed && (
                                <Badge variant="outline" className="rounded-full">
                                  modified
                                </Badge>
                              )}
                            </div>

                            <div className="mt-1 font-medium truncate">{p.name}</div>

                            {p.description ? (
                              <div className="text-sm text-muted-foreground mt-1">{p.description}</div>
                            ) : (
                              <div className="text-sm text-muted-foreground mt-1">—</div>
                            )}
                          </div>

                          <Button
                            variant={desired ? "outline" : "default"}
                            onClick={() => toggleDesired(p.code)}
                          >
                            {desired ? "Remove" : "Add"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {(diff.toAdd.length > 0 || diff.toRemove.length > 0) && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
                  <span className="font-medium">Pending changes:</span>{" "}
                  {diff.toAdd.length > 0 && (
                    <>
                      add <code>{diff.toAdd.length}</code>
                    </>
                  )}
                  {diff.toAdd.length > 0 && diff.toRemove.length > 0 && " • "}
                  {diff.toRemove.length > 0 && (
                    <>
                      remove <code>{diff.toRemove.length}</code>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPermOpen(false)} disabled={permSaving}>
              Cancel
            </Button>
            <Button onClick={saveManagePermissions} disabled={permLoading || permSaving}>
              {permSaving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit role</DialogTitle>
            <DialogDescription>
              Code is immutable: <code className="text-foreground">{editRole?.code || ""}</code>
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
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
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