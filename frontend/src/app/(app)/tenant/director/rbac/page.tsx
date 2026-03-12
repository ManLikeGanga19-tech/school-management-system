"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Search,
  RefreshCw,
  Trash2,
  Plus,
  CheckCircle,
  XCircle,
  Lock,
  Unlock,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantUser = {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
};

type Permission = {
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
};

type TenantRole = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
};

type PermissionOverride = {
  id?: string;
  user_id: string;
  email?: string;
  full_name?: string | null;
  user_email?: string;
  user_name?: string | null;
  permission_code: string;
  permission_name?: string;
  effect: "ALLOW" | "DENY";
  reason?: string | null;
  created_at?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name?: string | null, email?: string) {
  if (name?.trim()) {
    return name.trim().split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  }
  return email?.[0]?.toUpperCase() ?? "?";
}

function avatarColor(id: string) {
  const palette = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-purple-100 text-purple-700",
    "bg-rose-100 text-rose-700",
    "bg-cyan-100 text-cyan-700",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function timeAgo(iso?: string) {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Backend patch functions ──────────────────────────────────────────────────
// TODO: Replace each function body with your actual Python API endpoint logic.

/** Fetch all tenant users */
async function fetchUsers(): Promise<TenantUser[]> {
  // TODO: GET /api/tenant/director/users → { users: TenantUser[] }
  try {
    const data = await api.get<{ users: TenantUser[] } | TenantUser[]>("/tenants/director/users", { tenantRequired: true });
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.users) ? data.users : [];
  } catch {
    return [];
  }
}

/** Fetch all available permissions in the system */
async function fetchPermissions(): Promise<Permission[]> {
  // TODO: GET /api/tenant/director/rbac/permissions
  //       → { permissions: { code, name, description, category }[] }
  //       Implement in Python: query all Permission records for this tenant's roles
  try {
    const data = await api.get<{ permissions: Permission[] } | Permission[]>("/tenants/director/rbac/permissions", { tenantRequired: true, noRedirect: true });
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.permissions) ? data.permissions : [];
  } catch {
    return [];
  }
}

/** Fetch tenant + system roles available to the tenant context */
async function fetchRoles(): Promise<TenantRole[]> {
  try {
    const data = await api.get<{ roles: TenantRole[] } | TenantRole[]>("/tenants/director/roles", {
      tenantRequired: true,
      noRedirect: true,
    });
    const rows = Array.isArray(data) ? data : Array.isArray(data?.roles) ? data.roles : [];
    return rows
      .map((row) => ({
        id: String(row.id),
        code: String(row.code || "").toUpperCase(),
        name: String(row.name || ""),
        description: row.description ?? null,
      }))
      .filter((row) => row.id && row.code && row.name)
      .sort((a, b) => a.code.localeCompare(b.code));
  } catch {
    return [];
  }
}

/** Fetch all existing permission overrides */
async function fetchOverrides(): Promise<PermissionOverride[]> {
  // TODO: GET /api/tenant/director/rbac/overrides
  //       → { overrides: PermissionOverride[] }
  //       Implement in Python: query UserPermissionOverride for this tenant
  try {
    const data = await api.get<{ overrides: PermissionOverride[] } | PermissionOverride[]>("/tenants/director/rbac/overrides", { tenantRequired: true });
    const rows = Array.isArray(data) ? data : Array.isArray(data?.overrides) ? data.overrides : [];
    return rows.map((row, idx) => {
      const userEmail = row.user_email ?? row.email ?? "";
      const userName = row.user_name ?? row.full_name ?? null;
      const permissionName = row.permission_name ?? row.permission_code;
      return {
        ...row,
        id: row.id || `${row.user_id}:${row.permission_code}:${idx}`,
        user_email: userEmail,
        user_name: userName,
        permission_name: permissionName,
      };
    });
  } catch {
    return [];
  }
}

/** Save a new or updated permission override */
async function saveOverrideApi(payload: {
  user_id: string;
  permission_code: string;
  effect: "ALLOW" | "DENY";
}): Promise<{ ok: boolean; error?: string }> {
  // TODO: POST /api/tenant/director/rbac/overrides
  //       body: { user_id, permission_code, effect }
  //       Implement in Python: upsert UserPermissionOverride record
  try {
    await api.post("/tenants/director/rbac/overrides", payload, { tenantRequired: true });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Failed to save override" };
  }
}

/** Delete an existing permission override */
async function deleteOverrideApi(payload: {
  user_id: string;
  permission_code: string;
}): Promise<{ ok: boolean; error?: string }> {
  // TODO: DELETE /api/tenant/director/rbac/overrides
  //       body: { user_id, permission_code }
  //       Implement in Python: delete UserPermissionOverride record
  try {
    await api.delete("/tenants/director/rbac/overrides", payload, { tenantRequired: true });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Failed to delete override" };
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({
  title,
  subtitle,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="dashboard-surface rounded-[1.6rem]">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-slate-400" />}
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

function EffectBadge({ effect }: { effect: "ALLOW" | "DENY" }) {
  return effect === "ALLOW" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
      <Unlock className="h-3 w-3" />
      ALLOW
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
      <Lock className="h-3 w-3" />
      DENY
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TenantRbacPage() {
  const [users, setUsers]           = useState<TenantUser[]>([]);
  const [roles, setRoles]           = useState<TenantRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [overrides, setOverrides]   = useState<PermissionOverride[]>([]);
  const [loading, setLoading]       = useState(true);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [notice, setNotice]         = useState<string | null>(null);

  // Search / filter state
  const [userSearch, setUserSearch]         = useState("");
  const [permSearch, setPermSearch]         = useState("");
  const [overrideSearch, setOverrideSearch] = useState("");

  // New override dialog
  const [addOpen, setAddOpen]               = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedPerm, setSelectedPerm]     = useState("");
  const [selectedEffect, setSelectedEffect] = useState<"ALLOW" | "DENY">("ALLOW");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<PermissionOverride | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const [u, r, p, o] = await Promise.all([
      fetchUsers(),
      fetchRoles(),
      fetchPermissions(),
      fetchOverrides(),
    ]);
    setUsers(u);
    setRoles(r);
    setPermissions(p);
    setOverrides(o);
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 20_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    if (notice) toast.success(notice);
  }, [notice]);

  // ── Save override ─────────────────────────────────────────────────────────

  async function handleSaveOverride() {
    if (!selectedUserId || !selectedPerm) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await saveOverrideApi({
      user_id: selectedUserId,
      permission_code: selectedPerm,
      effect: selectedEffect,
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Failed to save override");
      return;
    }

    setNotice(`Override saved: ${selectedEffect} on "${selectedPerm}"`);
    setSelectedUserId(""); setSelectedPerm(""); setSelectedEffect("ALLOW");
    setAddOpen(false);
    await load(true);
  }

  // ── Delete override ───────────────────────────────────────────────────────

  async function handleDeleteOverride(override: PermissionOverride) {
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await deleteOverrideApi({
      user_id: override.user_id,
      permission_code: override.permission_code,
    });

    setBusy(false);
    setDeleteTarget(null);

    if (!result.ok) {
      setError(result.error ?? "Failed to delete override");
      return;
    }

    setNotice(`Override for "${override.permission_code}" removed.`);
    await load(true);
  }

  // ── Filtered lists ────────────────────────────────────────────────────────

  const filteredUsers = users.filter((u) => {
    const t = userSearch.toLowerCase();
    return !t || (u.full_name ?? "").toLowerCase().includes(t) || u.email.toLowerCase().includes(t);
  });

  const groupedPermissions = permissions.reduce((acc, p) => {
    const cat = p.category ?? "General";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {} as Record<string, Permission[]>);

  const filteredPermCategories = Object.entries(groupedPermissions).reduce(
    (acc, [cat, perms]) => {
      const filtered = perms.filter(
        (p) =>
          !permSearch ||
          p.code.toLowerCase().includes(permSearch.toLowerCase()) ||
          p.name.toLowerCase().includes(permSearch.toLowerCase())
      );
      if (filtered.length > 0) acc[cat] = filtered;
      return acc;
    },
    {} as Record<string, Permission[]>
  );

  const filteredOverrides = overrides.filter((o) => {
    const t = overrideSearch.toLowerCase();
    return (
      !t ||
      o.permission_code.toLowerCase().includes(t) ||
      (o.user_email ?? "").toLowerCase().includes(t) ||
      (o.user_name ?? "").toLowerCase().includes(t)
    );
  });

  const allowCount = overrides.filter((o) => o.effect === "ALLOW").length;
  const denyCount  = overrides.filter((o) => o.effect === "DENY").length;
  const selectedUserObj = users.find((u) => u.id === selectedUserId);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/director/rbac">

      {/* ── Add Override Dialog — top-level ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Permission Override</DialogTitle>
            <DialogDescription>
              Grant or deny a specific permission to a user, bypassing their role's default.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* User picker */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                User <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user…" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      <div className="flex items-center gap-2">
                        <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${avatarColor(u.id)}`}>
                          {initials(u.full_name, u.email)}
                        </div>
                        <span>{u.full_name || u.email}</span>
                        {u.full_name && <span className="text-xs text-slate-400">{u.email}</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedUserObj && (
                <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${avatarColor(selectedUserObj.id)}`}>
                    {initials(selectedUserObj.full_name, selectedUserObj.email)}
                  </div>
                  <div>
                    <span className="font-medium text-blue-900">{selectedUserObj.full_name || "—"}</span>
                    <span className="ml-2 text-blue-500">{selectedUserObj.email}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Permission picker */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Permission <span className="text-red-500">*</span>
              </Label>
              {permissions.length > 0 ? (
                <Select value={selectedPerm} onValueChange={setSelectedPerm}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a permission…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {Object.entries(groupedPermissions).map(([cat, perms]) => (
                      <div key={cat}>
                        <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {cat}
                        </div>
                        {perms.map((p) => (
                          <SelectItem key={p.code} value={p.code}>
                            <div>
                              <div className="font-medium">{p.name}</div>
                              <div className="font-mono text-xs text-slate-400">{p.code}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="e.g. finance.invoices.manage"
                  value={selectedPerm}
                  onChange={(e) => setSelectedPerm(e.target.value)}
                />
              )}
              {permissions.length === 0 && (
                <p className="text-xs text-slate-400">
                  Implement{" "}
                  <code className="rounded bg-slate-100 px-1">GET /api/tenant/director/rbac/permissions</code>{" "}
                  to load permissions as a dropdown.
                </p>
              )}
            </div>

            {/* Effect */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Effect</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["ALLOW", "DENY"] as const).map((eff) => (
                  <button
                    key={eff}
                    type="button"
                    onClick={() => setSelectedEffect(eff)}
                    className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-medium transition ${
                      selectedEffect === eff
                        ? eff === "ALLOW"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-red-200 bg-red-50 text-red-800"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {eff === "ALLOW"
                      ? <Unlock className="h-4 w-4" />
                      : <Lock className="h-4 w-4" />}
                    {eff}
                  </button>
                ))}
              </div>
            </div>

            <Separator />
            <p className="text-xs text-slate-400">
              This calls{" "}
              <code className="rounded bg-slate-100 px-1">POST /api/tenant/director/rbac/overrides</code>.
              Director-level action — use with care.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !selectedUserId || !selectedPerm}
              onClick={() => void handleSaveOverride()}
              className={selectedEffect === "ALLOW" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
            >
              {busy ? "Saving…" : `Apply ${selectedEffect} Override`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Override</DialogTitle>
            <DialogDescription>
              This will delete the <strong>{deleteTarget?.effect}</strong> override for{" "}
              <strong>{deleteTarget?.permission_code}</strong> on{" "}
              <strong>{deleteTarget?.user_name || deleteTarget?.user_email}</strong>. The user will
              revert to their role's default for this permission.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => deleteTarget && void handleDeleteOverride(deleteTarget)}
            >
              {busy ? "Removing…" : "Remove Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Page body ── */}
      <div className="space-y-5">

        {/* Header */}
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                  <ShieldCheck className="h-3 w-3" />
                  Director Access
                </span>
              </div>
              <h1 className="text-xl font-bold">RBAC Controls</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Tenant-scoped permission overrides — grant or deny specific access per user
              </p>
            </div>
            <div className="flex items-center gap-3">
              {[
                { label: "Users",       value: users.length       },
                { label: "Roles",       value: roles.length       },
                { label: "Permissions", value: permissions.length },
                { label: "Overrides",   value: overrides.length   },
                { label: "DENY active", value: denyCount, warn: denyCount > 0 },
              ].map((item) => (
                <div key={item.label} className={`rounded-xl px-4 py-2 text-center backdrop-blur ${item.warn ? "bg-red-500/20" : "bg-white/10"}`}>
                  <div className={`text-xl font-bold ${item.warn ? "text-red-200" : "text-white"}`}>{item.value}</div>
                  <div className="text-xs text-blue-200">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2"><XCircle className="h-4 w-4 shrink-0 text-red-500" />{error}</div>
            <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
        {notice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="flex items-center gap-2"><CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />{notice}</div>
            <button onClick={() => setNotice(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Overrides Table */}
        <SectionCard
          title="Active Permission Overrides"
          subtitle="Per-user overrides that bypass role defaults"
          icon={ShieldAlert}
          action={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search overrides…"
                  value={overrideSearch}
                  onChange={(e) => setOverrideSearch(e.target.value)}
                  className="h-8 w-48 pl-8 text-xs"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void load(true)}
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-blue-600 text-xs hover:bg-blue-700"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                New Override
              </Button>
            </div>
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="w-10 text-xs" />
                <TableHead className="text-xs">User</TableHead>
                <TableHead className="text-xs">Permission</TableHead>
                <TableHead className="text-xs">Effect</TableHead>
                <TableHead className="text-xs">Applied</TableHead>
                <TableHead className="w-10 text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center">
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading overrides…
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!loading && filteredOverrides.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <ShieldCheck className="h-7 w-7 text-slate-200" />
                      <p className="text-sm text-slate-400">
                        {overrideSearch ? "No overrides match your search." : "No overrides configured yet."}
                      </p>
                      {!overrideSearch && (
                        <p className="text-xs text-slate-300">
                          Click &ldquo;New Override&rdquo; to grant or deny a specific permission.
                        </p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!loading && filteredOverrides.map((o) => (
                <TableRow key={o.id} className="hover:bg-slate-50">
                  <TableCell className="py-3 pl-5">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${avatarColor(o.user_id)}`}>
                      {initials(o.user_name, o.user_email)}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="text-sm font-medium text-slate-900">{o.user_name || "—"}</div>
                    <div className="text-xs text-slate-400">{o.user_email}</div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="text-sm font-medium text-slate-800">
                      {o.permission_name || o.permission_code}
                    </div>
                    <div className="font-mono text-xs text-slate-400">{o.permission_code}</div>
                  </TableCell>
                  <TableCell className="py-3">
                    <EffectBadge effect={o.effect} />
                  </TableCell>
                  <TableCell className="py-3 text-xs text-slate-400">
                    {timeAgo(o.created_at)}
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setDeleteTarget(o)}
                            disabled={busy}
                            className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                          Remove override
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Stats footer */}
          {overrides.length > 0 && (
            <div className="flex items-center gap-4 border-t border-slate-100 px-6 py-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Unlock className="h-3.5 w-3.5 text-emerald-500" />
                {allowCount} ALLOW override{allowCount !== 1 ? "s" : ""}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Lock className="h-3.5 w-3.5 text-red-500" />
                {denyCount} DENY override{denyCount !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </SectionCard>

        {/* Two-column: Users | Permissions */}
        <SectionCard
          title="Role Catalog"
          subtitle="Roles loaded from tenant RBAC store"
          icon={ShieldCheck}
        >
          {roles.length === 0 ? (
            <div className="px-6 py-6 text-sm text-slate-500">No roles loaded.</div>
          ) : (
            <div className="grid gap-3 px-6 py-4 md:grid-cols-2 lg:grid-cols-3">
              {roles.map((role) => (
                <div key={role.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-900">{role.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{role.code}</div>
                  <div className="mt-1 text-xs text-slate-500">{role.description || "No description"}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Two-column: Users | Permissions */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* Users reference table */}
          <SectionCard
            title="Tenant Users"
            subtitle="Reference — select from this list when creating overrides"
            icon={ShieldCheck}
            action={
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search users…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="h-8 w-40 pl-8 text-xs"
                />
              </div>
            }
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="w-10 text-xs" />
                  <TableHead className="text-xs">User</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Overrides</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.slice(0, 10).map((u) => {
                  const userOverrideCount = overrides.filter((o) => o.user_id === u.id).length;
                  return (
                    <TableRow key={u.id} className="hover:bg-slate-50">
                      <TableCell className="py-2.5 pl-5">
                        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${avatarColor(u.id)}`}>
                          {initials(u.full_name, u.email)}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="text-sm font-medium text-slate-900">
                          {u.full_name || <span className="italic text-slate-400">No name</span>}
                        </div>
                        <div className="text-xs text-slate-400">{u.email}</div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge
                          variant="outline"
                          className={u.is_active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-500"}
                        >
                          <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${u.is_active ? "bg-emerald-500" : "bg-slate-400"}`} />
                          {u.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5">
                        {userOverrideCount > 0 ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                            {userOverrideCount} override{userOverrideCount !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">None</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-400">
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </SectionCard>

          {/* Permissions reference table */}
          <SectionCard
            title="Available Permissions"
            subtitle="All system permissions — use codes when creating overrides"
            icon={ShieldX}
            action={
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search permissions…"
                  value={permSearch}
                  onChange={(e) => setPermSearch(e.target.value)}
                  className="h-8 w-40 pl-8 text-xs"
                />
              </div>
            }
          >
            {permissions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <ShieldX className="h-8 w-8 text-slate-200" />
                <p className="text-sm text-slate-400">No permissions loaded</p>
                <p className="text-xs text-slate-300 max-w-xs">
                  Implement{" "}
                  <code className="rounded bg-slate-100 px-1">GET /api/tenant/director/rbac/permissions</code>{" "}
                  to populate this table.
                </p>
              </div>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
                {Object.entries(filteredPermCategories).map(([cat, perms]) => (
                  <div key={cat}>
                    <div className="sticky top-0 bg-slate-50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 border-y border-slate-100">
                      {cat}
                    </div>
                    {perms.map((p) => (
                      <div
                        key={p.code}
                        className="flex items-start justify-between gap-3 px-5 py-2.5 hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800">{p.name}</div>
                          <div className="font-mono text-xs text-slate-400">{p.code}</div>
                          {p.description && (
                            <div className="mt-0.5 text-xs text-slate-400 truncate max-w-xs">{p.description}</div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setSelectedPerm(p.code);
                            setAddOpen(true);
                          }}
                          className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 transition"
                        >
                          Override
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
