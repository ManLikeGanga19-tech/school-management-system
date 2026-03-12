"use client";

import { useEffect, useMemo, useState } from "react";
import { Pie, PieChart, Cell } from "recharts";
import {
  Users,
  UserPlus,
  ShieldCheck,
  ShieldOff,
  RefreshCw,
  Search,
  CheckCircle,
  XCircle,
  Pencil,
  Trash2,
  UserCog,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
import { TenantPageHeader, TenantSurface } from "@/components/tenant/page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
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
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantUser = {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  roles?: string[];
};

type TenantRole = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
};

type StaffCredentialCandidate = {
  staff_id: string;
  staff_no: string;
  full_name: string;
  email: string;
  staff_type: string;
  role_code?: string | null;
  has_account: boolean;
  user_id?: string | null;
};

type DirectorUserDeleteResult = {
  ok: boolean;
  user_id: string;
  membership_deactivated: boolean;
  user_deactivated: boolean;
  roles_removed: number;
  overrides_removed: number;
};

type EditUserForm = {
  full_name: string;
  email: string;
  password: string;
  is_active: "true" | "false";
};

// ─── Chart config ─────────────────────────────────────────────────────────────

const chartConfig = {
  active:   { label: "Active",   color: "#10b981" },
  inactive: { label: "Inactive", color: "#e2e8f0" },
};

const PIE_COLORS = ["#10b981", "#e2e8f0"];
const initialEditForm: EditUserForm = {
  full_name: "",
  email: "",
  password: "",
  is_active: "true",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name?: string | null, email?: string) {
  if (name?.trim()) {
    return name.trim().split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  }
  return email?.[0]?.toUpperCase() ?? "?";
}

function avatarColor(id: string): string {
  const palette = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-purple-100 text-purple-700",
    "bg-rose-100 text-rose-700",
    "bg-cyan-100 text-cyan-700",
    "bg-orange-100 text-orange-700",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function isAssignableRole(roleCode: string | null | undefined): boolean {
  return (roleCode ?? "").trim().toUpperCase() !== "SUPER_ADMIN";
}

// ─── Backend wiring ───────────────────────────────────────────────────────────
//
// TODO (Python backend):
//
//   GET  /api/v1/tenants/director/roles
//        → { roles: { id, code, name, description }[] }
//
//   GET  /api/v1/tenants/director/users
//        → { users: { id, email, full_name, is_active, roles?: string[] }[] }
//
//   POST /api/v1/tenants/director/users/credentials
//        body: { staff_id, password, role_code? }
//        → 201 on success
//
//   POST /api/v1/tenants/director/users/roles
//        body: { mode: "assign" | "remove", user_id, role_code }
//        → 200 on success
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Inline role badges for each table row ────────────────────────────────────

function InlineRoleAction({
  user,
  roles,
  onAction,
  busy,
}: {
  user: TenantUser;
  roles: TenantRole[];
  onAction: (userId: string, roleCode: string, mode: "assign" | "remove") => Promise<void>;
  busy: boolean;
}) {
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [open, setOpen] = useState(false);
  const userRoles = (user.roles ?? []).filter((code) => isAssignableRole(code));

  async function handleAssign() {
    if (!selectedRole) return;
    await onAction(user.id, selectedRole, "assign");
    setSelectedRole("");
    setOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {userRoles.length === 0 && (
        <span className="text-xs italic text-slate-300">No roles</span>
      )}
      {userRoles.map((role) => (
        <TooltipProvider key={role} delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => !busy && onAction(user.id, role, "remove")}
                disabled={busy}
                className="group inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200 transition hover:bg-red-50 hover:text-red-700 hover:ring-red-200"
              >
                {role}
                <XCircle className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Click to remove role
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}

      {/* Assign button — opens its own dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setOpen(true)}
          className="h-6 gap-1 rounded-full px-2 text-xs text-slate-500 hover:text-blue-700"
        >
          <ShieldCheck className="h-3 w-3" />
          Add
        </Button>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Role</DialogTitle>
            <DialogDescription>
              Choose a role to assign to{" "}
              <strong>{user.full_name || user.email}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-xs font-medium text-slate-600">Role</Label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role…" />
              </SelectTrigger>
              <SelectContent>
                {roles.length === 0 && (
                  <SelectItem value="__empty__" disabled>
                    No roles available in DB
                  </SelectItem>
                )}
                {roles.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    <span className="font-medium">{r.name}</span>
                    {r.description && (
                      <span className="ml-1.5 text-xs text-slate-400">{r.description}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selectedRole || busy}
              onClick={handleAssign}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Assign Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TenantUsersPage() {
  const [users, setUsers]     = useState<TenantUser[]>([]);
  const [roles, setRoles]     = useState<TenantRole[]>([]);
  const [staffCandidates, setStaffCandidates] = useState<StaffCredentialCandidate[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");

  // Provision credential dialog
  const [addOpen, setAddOpen]   = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newRole, setNewRole]   = useState("");
  const [addBusy, setAddBusy]   = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<TenantUser | null>(null);
  const [editForm, setEditForm] = useState<EditUserForm>(initialEditForm);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<TenantUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  async function loadUsers() {
    try {
      const data = await api.get<{ users: TenantUser[] } | TenantUser[]>("/tenants/director/users", { tenantRequired: true });
      const normalize = (rows: TenantUser[]) =>
        rows.map((row) => ({
          ...row,
          roles: Array.isArray(row.roles) ? row.roles.filter((code) => isAssignableRole(code)) : [],
        }));
      if (Array.isArray(data)) {
        setUsers(normalize(data));
      } else if ("users" in data && Array.isArray(data.users)) {
        setUsers(normalize(data.users));
      } else {
        setUsers([]);
      }
    } catch (err: any) {
      setError(typeof err?.message === "string" ? err.message : "Failed to load users");
    }
  }

  async function loadRoles() {
    try {
      const data = await api.get<{ roles: TenantRole[] }>("/tenants/director/roles", { tenantRequired: true, noRedirect: true });
      const rows = Array.isArray(data?.roles) ? data.roles : [];
      setRoles(rows.filter((role) => isAssignableRole(role.code)));
    } catch {
      // silently fail — roles endpoint may not exist yet
      setRoles([]);
    }
  }

  async function loadStaffCandidates() {
    try {
      const data = await api.get<StaffCredentialCandidate[] | { staff: StaffCredentialCandidate[] }>(
        "/tenants/director/users/staff-candidates?limit=500",
        { tenantRequired: true, noRedirect: true }
      );
      const rows: StaffCredentialCandidate[] = Array.isArray(data)
        ? data
        : Array.isArray((data as { staff?: StaffCredentialCandidate[] })?.staff)
          ? ((data as { staff: StaffCredentialCandidate[] }).staff ?? [])
          : [];
      const normalized = rows
        .map((row: StaffCredentialCandidate) => ({
          staff_id: String(row.staff_id || ""),
          staff_no: String(row.staff_no || ""),
          full_name: String(row.full_name || "").trim(),
          email: String(row.email || "").trim().toLowerCase(),
          staff_type: String(row.staff_type || "").trim().toUpperCase(),
          role_code: row.role_code ? String(row.role_code).trim().toUpperCase() : null,
          has_account: Boolean(row.has_account),
          user_id: row.user_id ? String(row.user_id) : null,
        }))
        .filter((row: StaffCredentialCandidate) => Boolean(row.staff_id && row.email));
      setStaffCandidates(normalized);
    } catch {
      setStaffCandidates([]);
    }
  }

  async function load(silent = false) {
    if (!silent) setLoading(true);
    await Promise.all([loadUsers(), loadRoles(), loadStaffCandidates()]);
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    if (notice) toast.success(notice);
  }, [notice]);

  const selectedStaff = useMemo(
    () => staffCandidates.find((item) => item.staff_id === selectedStaffId) ?? null,
    [staffCandidates, selectedStaffId]
  );

  // ── Role action ───────────────────────────────────────────────────────────

  async function runRoleAction(userId: string, roleCode: string, mode: "assign" | "remove") {
    if (!isAssignableRole(roleCode)) {
      setError("SUPER_ADMIN cannot be managed from tenant dashboard.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post("/tenants/director/users/roles", { mode, user_id: userId, role_code: roleCode }, { tenantRequired: true });
      setBusy(false);
      setNotice(`Role "${roleCode}" ${mode === "assign" ? "assigned" : "removed"} successfully.`);
      await load(true);
    } catch (err: any) {
      setBusy(false);
      setError(typeof err?.message === "string" ? err.message : "Role action failed");
      return;
    }
  }

  // ── Add user ──────────────────────────────────────────────────────────────

  async function addUser() {
    if (!selectedStaffId) {
      setError("Select a staff member first.");
      return;
    }
    if (!newPassword.trim()) {
      setError("Password is required.");
      return;
    }
    if (newPassword.trim().length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Password confirmation does not match.");
      return;
    }

    const payload: Record<string, unknown> = {
      staff_id: selectedStaffId,
      password: newPassword,
    };
    if (newRole && newRole !== "__none__" && newRole !== "__staff_default__") {
      if (!isAssignableRole(newRole)) {
        setError("SUPER_ADMIN cannot be assigned from tenant dashboard.");
        return;
      }
      payload.role_code = newRole;
    }

    setAddBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post("/tenants/director/users/credentials", payload, { tenantRequired: true });
      setAddBusy(false);
      setNotice("Login credential provisioned successfully.");
      setSelectedStaffId("");
      setNewPassword("");
      setConfirmPassword("");
      setNewRole("");
      setAddOpen(false);
      await load(true);
    } catch (err: any) {
      setAddBusy(false);
      setError(typeof err?.message === "string" ? err.message : "Failed to provision credential");
      return;
    }
  }

  function openEditDialog(user: TenantUser) {
    setEditUser(user);
    setEditForm({
      full_name: user.full_name ?? "",
      email: user.email,
      password: "",
      is_active: user.is_active ? "true" : "false",
    });
    setEditOpen(true);
  }

  async function saveUserChanges() {
    if (!editUser) return;

    const fullName = editForm.full_name.trim();
    const email = editForm.email.trim().toLowerCase();
    const password = editForm.password.trim();

    if (!email) {
      setError("Email is required.");
      return;
    }
    if (password && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    const payload: Record<string, unknown> = {
      full_name: fullName || null,
      email,
      is_active: editForm.is_active === "true",
    };
    if (password) payload.password = password;

    setEditBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/tenants/director/users/${encodeURIComponent(editUser.id)}`, payload, {
        tenantRequired: true,
      });
      setNotice("User access updated successfully.");
      setEditOpen(false);
      setEditUser(null);
      setEditForm(initialEditForm);
      await load(true);
    } catch (err: any) {
      setError(typeof err?.message === "string" ? err.message : "Failed to update user.");
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteUserAccess() {
    if (!deleteUser) return;

    setDeleteBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.delete<DirectorUserDeleteResult>(
        `/tenants/director/users/${encodeURIComponent(deleteUser.id)}`,
        undefined,
        { tenantRequired: true }
      );
      const removedRoles = Number(result?.roles_removed ?? 0);
      setNotice(
        removedRoles > 0
          ? `User access removed. ${removedRoles} tenant role${removedRoles === 1 ? "" : "s"} cleaned up.`
          : "User access removed successfully."
      );
      setDeleteOpen(false);
      setDeleteUser(null);
      await load(true);
    } catch (err: any) {
      setError(typeof err?.message === "string" ? err.message : "Failed to remove user access.");
    } finally {
      setDeleteBusy(false);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const activeCount   = users.filter((u) => u.is_active).length;
  const inactiveCount = users.length - activeCount;
  const activeRate    = users.length > 0 ? Math.round((activeCount / users.length) * 100) : 0;

  const pieData = [
    { name: "active",   value: activeCount   || 0 },
    { name: "inactive", value: inactiveCount || 0 },
  ];

  // Live search: filter by name, email, or user ID
  const filteredUsers = users.filter((u) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      (u.full_name ?? "").toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term) ||
      u.id.toLowerCase().includes(term)
    );
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/director/users">
      {/* ── Provision Login Credential Dialog ── */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            setSelectedStaffId("");
            setNewPassword("");
            setConfirmPassword("");
            setNewRole("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Provision Login Credential</DialogTitle>
            <DialogDescription>
              Create or reset tenant login credentials for a registered staff member.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Staff member <span className="text-red-500">*</span>
              </Label>
              <Select
                value={selectedStaffId}
                onValueChange={(value) => {
                  setSelectedStaffId(value);
                  if (!newRole) setNewRole("__staff_default__");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select staff..." />
                </SelectTrigger>
                <SelectContent>
                  {staffCandidates.map((staff) => (
                    <SelectItem key={staff.staff_id} value={staff.staff_id}>
                      {staff.full_name} ({staff.staff_no}) · {staff.email}
                    </SelectItem>
                  ))}
                  {staffCandidates.length === 0 && (
                    <SelectItem value="__empty__" disabled>
                      No eligible staff with email found
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {selectedStaff && (
                <p className="text-[11px] text-slate-500">
                  {selectedStaff.has_account
                    ? "Existing tenant account detected. Provisioning will reset password."
                    : "No account detected. Provisioning will create a new login for this staff member."}
                </p>
              )}
              {selectedStaff?.staff_type === "NON_TEACHING" && (
                <p className="text-[11px] text-amber-700">
                  Non-teaching staff usually do not require dashboard access. Keep role unassigned unless explicitly required.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Email</Label>
              <Input
                value={selectedStaff?.email ?? ""}
                readOnly
                placeholder="Selected staff email"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Role to assign <span className="text-slate-400">(optional)</span>
              </Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Use staff role..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__staff_default__">Use staff role</SelectItem>
                  <SelectItem value="__none__">No role assignment</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.name}
                    </SelectItem>
                  ))}
                  {roles.length === 0 && (
                    <SelectItem value="__empty__" disabled>
                      No roles loaded from DB yet
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Password <span className="text-red-500">*</span>
              </Label>
              <PasswordInput
                placeholder="At least 8 characters, include letters and numbers"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Confirm password <span className="text-red-500">*</span>
              </Label>
              <PasswordInput
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addUser()}
              />
            </div>

            <Separator />

            <p className="text-xs text-slate-400">
              Calls{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5">
                POST /api/v1/tenants/director/users/credentials
              </code>
              {" "}to create/reset account credentials for staff.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={addBusy || !selectedStaffId || !newPassword.trim() || !confirmPassword.trim()}
              onClick={addUser}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {addBusy ? (
                <span className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Provisioning…
                </span>
              ) : "Provision Credential"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setEditUser(null);
            setEditForm(initialEditForm);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Tenant User</DialogTitle>
            <DialogDescription>
              Update identity details, reset password, or deactivate access for this tenant user.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Full name</Label>
                <Input
                  value={editForm.full_name}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, full_name: event.target.value }))
                  }
                  placeholder="User full name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Status</Label>
                <Select
                  value={editForm.is_active}
                  onValueChange={(value) =>
                    setEditForm((current) => ({ ...current, is_active: value as "true" | "false" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Active</SelectItem>
                    <SelectItem value="false">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Email</Label>
              <Input
                value={editForm.email}
                onChange={(event) =>
                  setEditForm((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="user@school.test"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Reset password <span className="text-slate-400">(optional)</span>
              </Label>
              <PasswordInput
                value={editForm.password}
                onChange={(event) =>
                  setEditForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="Leave blank to keep current password"
              />
              <p className="text-[11px] text-slate-400">
                Setting a new password will immediately replace the existing credential.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveUserChanges}
              disabled={editBusy || !editUser}
              className="bg-[#173f49] hover:bg-[#132129]"
            >
              {editBusy ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteUser(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove Tenant Access</DialogTitle>
            <DialogDescription>
              This removes the user's access to this tenant, clears tenant-scoped roles and overrides,
              and keeps audit history intact.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            <div className="font-medium">{deleteUser?.full_name || deleteUser?.email || "User"}</div>
            <div className="mt-1 text-xs text-rose-700">
              {deleteUser?.email}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={deleteUserAccess}
              disabled={deleteBusy || !deleteUser}
            >
              {deleteBusy ? "Removing..." : "Remove access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Page body ── */}
      <div className="space-y-5">

        <TenantPageHeader
          title="User Credentials & Role Management"
          description="Provision staff logins, update access details, assign roles, and remove tenant access without compromising audit history."
          badges={[{ label: "Director Workspace", icon: UserCog }]}
          metrics={[
            { label: "Total", value: users.length },
            { label: "Active", value: activeCount },
            { label: "Roles", value: roles.length },
          ]}
          actions={
            <>
              <Button
                variant="secondary"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                onClick={() => void load(true)}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button
                className="bg-[#b9512d] text-white hover:bg-[#a34727]"
                onClick={() => setAddOpen(true)}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Provision Login
              </Button>
            </>
          }
        />

        {/* Alerts */}
        {error && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 shrink-0 text-red-500" />
              {error}
            </div>
            <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
        {notice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
              {notice}
            </div>
            <button onClick={() => setNotice(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Stats row */}
        <div className="grid gap-5 lg:grid-cols-3">

          {/* Pie chart — fixed height container */}
          <TenantSurface className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">User Activity</h2>
                <p className="text-xs text-slate-400">Active vs inactive accounts</p>
              </div>
            </div>

            {users.length > 0 ? (
              <div className="flex items-center justify-between gap-4">
                {/* Chart — explicit fixed size so it doesn't stretch */}
                <div className="h-[160px] w-[160px] shrink-0">
                  <ChartContainer config={chartConfig} className="h-full w-full">
                    <PieChart width={160} height={160}>
                      <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx={75}
                        cy={75}
                        innerRadius={46}
                        outerRadius={72}
                        strokeWidth={2}
                        stroke="#fff"
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </div>

                {/* Legend */}
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                      Active
                    </div>
                    <div className="text-2xl font-bold text-slate-800">{activeCount}</div>
                    <div className="text-xs text-slate-400">{activeRate}% of total</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                      Inactive
                    </div>
                    <div className="text-2xl font-bold text-slate-800">{inactiveCount}</div>
                    <div className="text-xs text-slate-400">{100 - activeRate}% of total</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-[160px] items-center justify-center text-sm text-slate-400">
                No users yet
              </div>
            )}
          </TenantSurface>

          {/* Available Roles */}
          <TenantSurface className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Available Roles</h2>
                <p className="text-xs text-slate-400">Loaded from database</p>
              </div>
            </div>

            {roles.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <ShieldOff className="h-8 w-8 text-slate-200" />
                <p className="text-sm text-slate-400">No roles loaded yet</p>
                <p className="text-xs text-slate-300">
                  Implement{" "}
                  <code className="rounded bg-slate-100 px-1">GET /api/v1/tenants/director/roles</code>
                </p>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 180 }}>
                {roles.map((role) => (
                  <div
                    key={role.code}
                    className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <div className="mt-0.5 rounded-lg bg-blue-50 p-1.5 shrink-0">
                      <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800">{role.name}</div>
                      <div className="font-mono text-xs text-slate-400">{role.code}</div>
                      {role.description && (
                        <div className="mt-0.5 truncate text-xs text-slate-400">{role.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TenantSurface>

          {/* Quick stat pills */}
          <div className="flex flex-col gap-3">
            {[
              {
                label: "Total Users",
                value: users.length,
                sub: "Registered accounts",
                color: "border-blue-100 bg-blue-50",
                valColor: "text-blue-900",
                subColor: "text-blue-400",
              },
              {
                label: "Active Users",
                value: activeCount,
                sub: `${activeRate}% activity rate`,
                color: "border-emerald-100 bg-emerald-50",
                valColor: "text-emerald-900",
                subColor: "text-emerald-400",
              },
              {
                label: "Inactive Users",
                value: inactiveCount,
                sub: "Disabled accounts",
                color: "border-slate-100 bg-slate-50",
                valColor: "text-slate-900",
                subColor: "text-slate-400",
              },
              {
                label: "Available Roles",
                value: roles.length,
                sub: "In RBAC system",
                color: "border-purple-100 bg-purple-50",
                valColor: "text-purple-900",
                subColor: "text-purple-400",
              },
            ].map((item) => (
              <div
                key={item.label}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 ${item.color}`}
              >
                <div>
                  <div className={`text-xs font-medium ${item.subColor}`}>{item.label}</div>
                  <div className={`text-xs ${item.subColor}`}>{item.sub}</div>
                </div>
                <div className={`text-2xl font-bold ${item.valColor}`}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Users table */}
        <TenantSurface className="overflow-hidden">
          {/* Table header toolbar */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-900">Tenant Users</h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                {filteredUsers.length} of {users.length} user{users.length !== 1 ? "s" : ""} ·
                Hover ID to copy · Click role badge to remove · click Add to assign
              </p>
            </div>

            {/* Search + controls */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search name, email, ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-52 pl-8 text-xs"
                />
              </div>

              <Badge variant="outline" className="border-[#d8c4a6] bg-[#f7f3ec] text-[#6b4f35]">
                {filteredUsers.length} visible
              </Badge>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="w-12 text-xs" />
                  <TableHead className="text-xs">User</TableHead>
                  <TableHead className="text-xs">User ID</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Roles</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center">
                      <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Loading users…
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && filteredUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Users className="h-6 w-6 text-slate-200" />
                        <span className="text-sm text-slate-400">
                          {search.trim()
                            ? `No users matching "${search}"`
                            : "No users found."}
                        </span>
                        {search.trim() && (
                          <button
                            onClick={() => setSearch("")}
                            className="mt-1 text-xs text-blue-500 hover:underline"
                          >
                            Clear search
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && filteredUsers.map((u) => (
                  <TableRow key={u.id} className="hover:bg-slate-50">
                    {/* Avatar */}
                    <TableCell className="py-3 pl-6">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${avatarColor(u.id)}`}
                      >
                        {initials(u.full_name, u.email)}
                      </div>
                    </TableCell>

                    {/* Name + email */}
                    <TableCell className="py-3">
                      <div className="text-sm font-medium text-slate-900">
                        {u.full_name || (
                          <span className="italic text-slate-400">No name</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">{u.email}</div>
                    </TableCell>

                    {/* ID with tooltip */}
                    <TableCell className="py-3">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default font-mono text-xs text-slate-400 hover:text-slate-700">
                              {u.id.slice(0, 8)}…
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <span className="font-mono text-xs">{u.id}</span>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>

                    {/* Status badge */}
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={
                          u.is_active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                        }
                      >
                        <span
                          className={`mr-1.5 inline-flex h-1.5 w-1.5 rounded-full ${
                            u.is_active ? "bg-emerald-500" : "bg-slate-400"
                          }`}
                        />
                        {u.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>

                    {/* Inline role management */}
                    <TableCell className="py-3">
                      <InlineRoleAction
                        user={u}
                        roles={roles}
                        onAction={runRoleAction}
                        busy={busy}
                      />
                    </TableCell>
                    <TableCell className="py-3 pr-6">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => openEditDialog(u)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 border-rose-200 text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                          onClick={() => {
                            setDeleteUser(u);
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TenantSurface>
      </div>
    </AppShell>
  );
}
