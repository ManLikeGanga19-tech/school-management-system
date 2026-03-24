"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { DashboardStatCard } from "@/components/dashboard/dashboard-primitives";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { apiFetch } from "@/lib/api";
import {
  ShieldCheck,
  ShieldOff,
  Globe,
  Building2,
  Plus,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  Eye,
  Lock,
  XCircle,
  CheckCircle,
  Layers,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uniq(arr: string[]) {
  return Array.from(new Set((arr ?? []).filter(Boolean)));
}

function toSet(arr: string[]) {
  return new Set((arr ?? []).filter(Boolean));
}

function setToArray(s: Set<string>) {
  return Array.from(s);
}

function avatarColor(id: string) {
  const palette = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-purple-100 text-purple-700",
    "bg-rose-100 text-rose-700",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function isRetiredPrincipalAlias(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  return normalized === "HEAD_TEACHER" || normalized === "HEADTEACHER";
}

// ─── Scope badge ──────────────────────────────────────────────────────────────

function ScopeBadge({ isSystem, tenantId }: { isSystem?: boolean; tenantId?: string | null }) {
  if (isSystem) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
        <Lock className="h-3 w-3" />
        system
      </span>
    );
  }
  if (tenantId) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
        <Building2 className="h-3 w-3" />
        tenant
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
      <Globe className="h-3 w-3" />
      global
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaaSRolesPage() {
  const [rows, setRows]       = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);

  // Tenants
  const [tenants, setTenants]             = useState<TenantRow[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [tenantId, setTenantId]           = useState<string>("");

  // Filters
  const [scope, setScope] = useState<"global" | "tenant" | "all">("global");
  const [q, setQ]         = useState("");

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);

  // ── Create dialog ─────────────────────────────────────────────────────────
  const [openCreate, setOpenCreate] = useState(false);
  const [cScope, setCScope]         = useState<"global" | "tenant">("global");
  const [cCode, setCCode]           = useState("");
  const [cName, setCName]           = useState("");
  const [cDesc, setCDesc]           = useState("");
  const [creating, setCreating]     = useState(false);

  // ── Inspect dialog ────────────────────────────────────────────────────────
  const [inspectOpen, setInspectOpen]   = useState(false);
  const [inspectRole, setInspectRole]   = useState<RoleRow | null>(null);
  const [inspectPerms, setInspectPerms] = useState<string[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  // ── Edit dialog ───────────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleRow | null>(null);
  const [eName, setEName]       = useState("");
  const [eDesc, setEDesc]       = useState("");
  const [saving, setSaving]     = useState(false);

  // ── Manage permissions dialog ─────────────────────────────────────────────
  const [permOpen, setPermOpen]         = useState(false);
  const [permRole, setPermRole]         = useState<RoleRow | null>(null);
  const [permLoading, setPermLoading]   = useState(false);
  const [permSaving, setPermSaving]     = useState(false);
  const [permCatalog, setPermCatalog]   = useState<PermissionRow[]>([]);
  const [permSearch, setPermSearch]     = useState("");
  const [baseAssigned, setBaseAssigned] = useState<string[]>([]);
  const [desiredAssigned, setDesiredAssigned] = useState<string[]>([]);

  // ── Load tenants ──────────────────────────────────────────────────────────

  async function loadTenants() {
    setTenantsLoading(true);
    try {
      const data = await apiFetch<TenantRow[]>("/admin/tenants", {
        method: "GET",
        tenantRequired: false,
      });
      setTenants(data ?? []);
      if (!tenantId) {
        const first = (data ?? []).find((t) => t.is_active);
        if (first) setTenantId(first.id);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load tenants");
    } finally {
      setTenantsLoading(false);
    }
  }

  // ── Load roles ────────────────────────────────────────────────────────────

  async function loadRoles(overrides?: { scope?: typeof scope; tenantId?: string }) {
    const effectiveScope    = overrides?.scope    ?? scope;
    const effectiveTenantId = overrides?.tenantId ?? tenantId;

    if ((effectiveScope === "tenant" || effectiveScope === "all") && !effectiveTenantId) {
      setRows([]);
      setErr("Select a tenant to view tenant or all-scope roles.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr(null);
    try {
      const data = await listRoles(effectiveScope, {
        tenantId: effectiveTenantId || undefined,
      } as any);
      setRows(data ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't load roles");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadTenants(); }, []);
  useEffect(() => { void loadRoles();   }, [scope, tenantId]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const visibleRows = rows.filter((r) => !isRetiredPrincipalAlias(r.code));
    if (!needle) return visibleRows;
    return visibleRows.filter((r) =>
      `${r.code} ${r.name ?? ""} ${r.description ?? ""} ${r.tenant_id ?? ""}`.toLowerCase().includes(needle)
    );
  }, [rows, q]);

  const visibleRows = useMemo(
    () => rows.filter((r) => !isRetiredPrincipalAlias(r.code)),
    [rows]
  );
  const globalCount = visibleRows.filter((r) => !r.tenant_id && !r.is_system).length;
  const tenantCount = visibleRows.filter((r) => !!r.tenant_id).length;
  const systemCount = visibleRows.filter((r) => r.is_system).length;

  const selectedTenant = tenants.find((t) => t.id === tenantId) ?? null;

  // ── Create ────────────────────────────────────────────────────────────────

  async function onCreate() {
    const code = cCode.trim();
    const name = cName.trim();
    if (!code) return toast.error("Role code is required");
    if (!name) return toast.error("Role name is required");
    if (cScope === "tenant" && !tenantId) return toast.error("Select a tenant first");

    setCreating(true);
    try {
      await createRole({
        code,
        name,
        description: cDesc.trim() || undefined,
        scope: cScope,
        tenantId: cScope === "tenant" ? tenantId : undefined,
      } as any);
      toast.success("Role created");
      setOpenCreate(false);
      setCCode(""); setCName(""); setCDesc("");
      await loadRoles();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create role");
    } finally {
      setCreating(false);
    }
  }

  // ── Inspect ───────────────────────────────────────────────────────────────

  async function openInspect(role: RoleRow) {
    setInspectRole(role);
    setInspectPerms([]);
    setInspectOpen(true);
    setInspectLoading(true);
    try {
      const res = await getRolePermissions(role.id);
      setInspectPerms(res.permissions ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load permissions");
    } finally {
      setInspectLoading(false);
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  function openEdit(role: RoleRow) {
    setEditRole(role);
    setEName(role.name ?? "");
    setEDesc(role.description ?? "");
    setEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editRole) return;
    const name = eName.trim();
    if (!name) return toast.error("Role name is required");
    setSaving(true);
    try {
      await updateRole(editRole.id, { name, description: eDesc.trim() || undefined });
      toast.success("Role updated");
      setEditOpen(false);
      setEditRole(null);
      await loadRoles();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update role");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function onDelete(role: RoleRow) {
    if (role.is_system) return toast.error("System roles cannot be deleted");
    try {
      await deleteRole(role.id);
      toast.success("Role deleted");
      setDeleteTarget(null);
      await loadRoles();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete role");
    }
  }

  // ── Manage permissions ────────────────────────────────────────────────────

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
      const base = uniq(assigned.permissions ?? []);
      setPermCatalog(catalog ?? []);
      setBaseAssigned(base);
      setDesiredAssigned(base);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load permissions");
    } finally {
      setPermLoading(false);
    }
  }

  const desiredSet = useMemo(() => toSet(desiredAssigned), [desiredAssigned]);
  const baseSet    = useMemo(() => toSet(baseAssigned),    [baseAssigned]);

  function toggleDesired(code: string) {
    setDesiredAssigned((prev) => {
      const s = new Set(prev);
      if (s.has(code)) s.delete(code); else s.add(code);
      return setToArray(s);
    });
  }

  const diff = useMemo(() => {
    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const c of desiredSet) if (!baseSet.has(c)) toAdd.push(c);
    for (const c of baseSet) if (!desiredSet.has(c)) toRemove.push(c);
    return { toAdd: toAdd.sort(), toRemove: toRemove.sort() };
  }, [baseSet, desiredSet]);

  const filteredPermCatalog = useMemo(() => {
    const needle = permSearch.trim().toLowerCase();
    if (!needle) return permCatalog;
    return permCatalog.filter((p) =>
      `${p.code} ${p.name ?? ""} ${p.description ?? ""}`.toLowerCase().includes(needle)
    );
  }, [permCatalog, permSearch]);

  // Group permissions by category
  const groupedPerms = useMemo(() =>
    filteredPermCatalog.reduce((acc, p) => {
      const cat = (p as any).category ?? "General";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(p);
      return acc;
    }, {} as Record<string, PermissionRow[]>),
    [filteredPermCatalog]
  );

  async function saveManagePermissions() {
    if (!permRole) return;
    if (diff.toAdd.length === 0 && diff.toRemove.length === 0) {
      toast.message("No changes to save");
      setPermOpen(false);
      return;
    }
    setPermSaving(true);
    try {
      if (diff.toAdd.length)    await addRolePermissions(permRole.id, diff.toAdd);
      if (diff.toRemove.length) await removeRolePermissions(permRole.id, diff.toRemove);
      toast.success("Permissions updated");
      const res   = await getRolePermissions(permRole.id);
      const fresh = uniq(res.permissions ?? []);
      setBaseAssigned(fresh);
      setDesiredAssigned(fresh);
      setPermOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update permissions");
    } finally {
      setPermSaving(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/rbac/roles">

      {/* ── Delete confirm ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role "{deleteTarget?.code}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the role. Ensure it is unassigned from all users first.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && void onDelete(deleteTarget)}
            >
              Delete Role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Create role dialog ── */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Role</DialogTitle>
            <DialogDescription>
              Create a <strong>global</strong> role (platform-wide) or a{" "}
              <strong>tenant</strong> role scoped to one institution.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Scope</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["global", "tenant"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setCScope(s)}
                    className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-medium transition ${
                      cScope === s
                        ? "border-blue-200 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {s === "global"
                      ? <Globe className="h-4 w-4" />
                      : <Building2 className="h-4 w-4" />}
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              {cScope === "tenant" && (
                <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Will be scoped to:{" "}
                  <strong>{selectedTenant?.name ?? "no tenant selected"}</strong>
                  {!tenantId && (
                    <span className="ml-1 text-red-600">— select a tenant in the filters first</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Role Code <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="e.g. SUPER_ADMIN"
                value={cCode}
                onChange={(e) => setCCode(e.target.value.toUpperCase())}
                className="font-mono"
              />
              <p className="text-xs text-slate-400">Uppercase. Immutable after creation.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Display Name <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="e.g. Super Admin"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Description</Label>
              <Textarea
                placeholder="What does this role allow?"
                value={cDesc}
                onChange={(e) => setCDesc(e.target.value)}
                className="resize-none"
                rows={3}
              />
            </div>

            <Separator />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)} disabled={creating}>Cancel</Button>
            <Button
              onClick={() => void onCreate()}
              disabled={creating || !cCode.trim() || !cName.trim() || (cScope === "tenant" && !tenantId)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating…
                </span>
              ) : "Create Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Inspect dialog ── */}
      <Dialog open={inspectOpen} onOpenChange={setInspectOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Role Permissions</DialogTitle>
            <DialogDescription>
              Permissions currently assigned to{" "}
              <code className="rounded bg-slate-100 px-1">{inspectRole?.code}</code>
            </DialogDescription>
          </DialogHeader>
          {inspectLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-8 w-1/2" />
            </div>
          ) : inspectPerms.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ShieldOff className="h-8 w-8 text-slate-200" />
              <p className="text-sm text-slate-400">No permissions assigned to this role.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-100 bg-slate-50 p-4">
              {inspectPerms.map((p) => (
                <span
                  key={p}
                  className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-medium text-blue-700 ring-1 ring-blue-200"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInspectOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription>
              Code is immutable:{" "}
              <code className="rounded bg-slate-100 px-1">{editRole?.code}</code>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Display Name *</Label>
              <Input value={eName} onChange={(e) => setEName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Description</Label>
              <Textarea
                value={eDesc}
                onChange={(e) => setEDesc(e.target.value)}
                className="resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button
              onClick={() => void onSaveEdit()}
              disabled={saving || !eName.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Manage permissions dialog ── */}
      <Dialog open={permOpen} onOpenChange={setPermOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Permissions</DialogTitle>
            <DialogDescription>
              Role:{" "}
              <code className="rounded bg-slate-100 px-1">{permRole?.code}</code>
              {" · "}
              <span className="text-slate-500">
                {desiredAssigned.length} assigned · {diff.toAdd.length} to add · {diff.toRemove.length} to remove
              </span>
            </DialogDescription>
          </DialogHeader>

          {permLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-10 w-1/2" />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Search + diff summary */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Search permissions…"
                    value={permSearch}
                    onChange={(e) => setPermSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
                {(diff.toAdd.length > 0 || diff.toRemove.length > 0) && (
                  <div className="flex items-center gap-2 shrink-0">
                    {diff.toAdd.length > 0 && (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                        +{diff.toAdd.length} to add
                      </span>
                    )}
                    {diff.toRemove.length > 0 && (
                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200">
                        -{diff.toRemove.length} to remove
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Permission list grouped by category */}
              <div className="max-h-[420px] overflow-y-auto rounded-xl border border-slate-100">
                {Object.keys(groupedPerms).length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-400">
                    No permissions match your search.
                  </div>
                ) : (
                  Object.entries(groupedPerms).map(([cat, perms]) => (
                    <div key={cat}>
                      <div className="sticky top-0 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {cat}
                      </div>
                      {perms.map((p) => {
                        const desired    = desiredSet.has(p.code);
                        const originally = baseSet.has(p.code);
                        const changed    = desired !== originally;

                        return (
                          <div
                            key={p.id}
                            className={`flex items-center justify-between gap-3 border-b border-slate-50 px-4 py-3 last:border-0 ${
                              changed ? "bg-amber-50/50" : "hover:bg-slate-50"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                                  {p.code}
                                </code>
                                {desired && (
                                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 ring-1 ring-blue-200">
                                    assigned
                                  </span>
                                )}
                                {changed && (
                                  <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                                    desired
                                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                      : "bg-red-50 text-red-700 ring-red-200"
                                  }`}>
                                    {desired ? "adding" : "removing"}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-sm font-medium text-slate-800">{p.name}</div>
                              {p.description && (
                                <div className="mt-0.5 text-xs text-slate-400">{p.description}</div>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant={desired ? "outline" : "default"}
                              className={desired
                                ? "h-7 border-red-200 bg-red-50 text-xs text-red-700 hover:bg-red-100"
                                : "h-7 bg-blue-600 text-xs hover:bg-blue-700"}
                              onClick={() => toggleDesired(p.code)}
                            >
                              {desired ? "Remove" : "Add"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Pending changes banner */}
              {(diff.toAdd.length > 0 || diff.toRemove.length > 0) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <strong>Pending changes — unsaved:</strong>{" "}
                  {diff.toAdd.length > 0 && (
                    <span>Adding: {diff.toAdd.join(", ")}</span>
                  )}
                  {diff.toAdd.length > 0 && diff.toRemove.length > 0 && " · "}
                  {diff.toRemove.length > 0 && (
                    <span>Removing: {diff.toRemove.join(", ")}</span>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPermOpen(false)} disabled={permSaving}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveManagePermissions()}
              disabled={permLoading || permSaving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {permSaving ? (
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </span>
              ) : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Page body ── */}
      <div className="space-y-5">

        {/* Header */}
        <SaasPageHeader
          title="Role Catalog"
          description="Platform and tenant-scoped role governance with direct access to permission bundles and assignment posture."
          badges={[
            { label: "Super Admin", icon: ShieldCheck },
            { label: "RBAC Roles", icon: Layers },
          ]}
          metrics={[
            { label: "Visible", value: filtered.length },
            { label: "Global", value: globalCount },
            { label: "Tenant", value: tenantCount },
            { label: "System", value: systemCount },
          ]}
        />

        {/* Error */}
        {err && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2"><XCircle className="h-4 w-4 shrink-0 text-red-500" />{err}</div>
            <button onClick={() => setErr(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Tenant required warning */}
        {(scope === "tenant" || scope === "all") && !tenantId && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Building2 className="h-4 w-4 shrink-0 text-amber-500" />
            Select a tenant in the filter below to view <strong>{scope}</strong>-scoped roles.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DashboardStatCard label="Global Roles" value={globalCount} sub="Platform-wide access profiles" icon={Globe} tone="secondary" />
          <DashboardStatCard label="Tenant Roles" value={tenantCount} sub="School-specific role sets" icon={Building2} tone="accent" />
          <DashboardStatCard label="System Roles" value={systemCount} sub="Protected platform roles" icon={Lock} tone="neutral" />
          <DashboardStatCard
            label={selectedTenant ? "Tenant Context" : "Tenant Context"}
            value={selectedTenant ? selectedTenant.slug : "—"}
            sub={selectedTenant ? selectedTenant.name : "Select a tenant when using tenant/all scope"}
            icon={selectedTenant ? CheckCircle : ShieldOff}
            tone={selectedTenant ? "sage" : "warning"}
          />
        </div>

        {/* Roles table card */}
        <SaasSurface className="overflow-hidden">

          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Roles</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {filtered.length} of {visibleRows.length} role{visibleRows.length !== 1 ? "s" : ""}
                  {q.trim() ? ` matching "${q}"` : ""}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Tenant selector */}
              <Select
                value={tenantId || "__none__"}
                onValueChange={(v) => setTenantId(v === "__none__" ? "" : v)}
                disabled={tenantsLoading}
              >
                <SelectTrigger className="h-8 w-full text-xs sm:w-56">
                  <SelectValue placeholder={tenantsLoading ? "Loading…" : "Select tenant…"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No tenant</SelectItem>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {!t.is_active && " (inactive)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Scope selector */}
              <Select value={scope} onValueChange={(v: any) => setScope(v)}>
                <SelectTrigger className="h-8 w-full text-xs sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="tenant">Tenant</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>

              {/* Search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search code, name…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="h-8 w-full pl-8 text-xs sm:w-44"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void loadRoles()}
                disabled={loading}
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </Button>

              <Button
                size="sm"
                className="h-8 gap-1.5 bg-blue-600 text-xs hover:bg-blue-700"
                onClick={() => setOpenCreate(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Create Role
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="w-10 text-xs" />
                  <TableHead className="text-xs">Code</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Scope</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs">Tenant</TableHead>
                  <TableHead className="w-48 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>

                {loading && (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7} className="py-3 px-5">
                        <Skeleton className="h-10 w-full rounded-xl" />
                      </TableCell>
                    </TableRow>
                  ))
                )}

                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Layers className="h-7 w-7 text-slate-200" />
                        <p className="text-sm text-slate-400">
                          {q.trim() ? `No roles matching "${q}"` : "No roles found."}
                        </p>
                        {q.trim() && (
                          <button onClick={() => setQ("")} className="mt-1 text-xs text-blue-500 hover:underline">
                            Clear search
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && filtered.map((r) => (
                  <TableRow key={r.id} className={`hover:bg-slate-50 ${r.is_system ? "opacity-75" : ""}`}>

                    {/* Icon avatar */}
                    <TableCell className="py-3 pl-5">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${avatarColor(r.id)}`}>
                        {r.code[0]}
                      </div>
                    </TableCell>

                    {/* Code */}
                    <TableCell className="py-3">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <code className="cursor-default rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
                              {r.code}
                            </code>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <span className="font-mono text-xs">ID: {r.id}</span>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>

                    {/* Name */}
                    <TableCell className="py-3">
                      <div className="text-sm font-medium text-slate-900">{r.name}</div>
                    </TableCell>

                    {/* Scope badge */}
                    <TableCell className="py-3">
                      <ScopeBadge isSystem={r.is_system} tenantId={r.tenant_id} />
                    </TableCell>

                    {/* Description */}
                    <TableCell className="max-w-xs py-3">
                      <p className="truncate text-xs text-slate-400">
                        {r.description || "—"}
                      </p>
                    </TableCell>

                    {/* Tenant slug */}
                    <TableCell className="py-3">
                      {r.tenant_id ? (
                        <code className="text-xs text-slate-400">
                          {tenants.find((t) => t.id === r.tenant_id)?.slug ?? r.tenant_id.slice(0, 8) + "…"}
                        </code>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="py-3 pr-4">
                      <div className="flex items-center gap-1">
                        <TooltipProvider delayDuration={200}>
                          {/* Inspect */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => void openInspect(r)}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">Inspect permissions</TooltipContent>
                          </Tooltip>

                          {/* Manage permissions */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => void openManagePermissions(r)}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-700"
                              >
                                <ShieldCheck className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">Manage permissions</TooltipContent>
                          </Tooltip>

                          {/* Edit */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => openEdit(r)}
                                disabled={r.is_system}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-700 disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">
                              {r.is_system ? "System roles cannot be edited" : "Edit role"}
                            </TooltipContent>
                          </Tooltip>

                          {/* Delete */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => !r.is_system && setDeleteTarget(r)}
                                disabled={r.is_system}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">
                              {r.is_system ? "System roles cannot be deleted" : "Delete role"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Footer */}
          {filtered.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Globe className="h-3.5 w-3.5 text-blue-400" />
                {globalCount} global
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Building2 className="h-3.5 w-3.5 text-amber-400" />
                {tenantCount} tenant
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                {systemCount} system
              </span>
              <span className="text-xs text-slate-400 sm:ml-auto">
                Hover role ID for full UUID
              </span>
            </div>
          )}
        </SaasSurface>
      </div>
    </AppShell>
  );
}
