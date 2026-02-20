"use client";

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart } from "recharts";

import { AppShell } from "@/components/layout/AppShell";
import { secretaryNav } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantUser = {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
};

type Me = {
  roles?: string[];
  permissions?: string[];
};

type UsersResponse = {
  users: TenantUser[];
  me: Me | null;
};

const chartConfig = {
  active:   { label: "Active",   color: "#10b981" },
  inactive: { label: "Inactive", color: "#e2e8f0" },
};

const COLORS = ["#10b981", "#e2e8f0"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name?: string | null, email?: string) {
  if (name?.trim()) {
    return name.trim().split(" ").slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }
  return email?.[0]?.toUpperCase() ?? "?";
}

function avatarColor(str: string) {
  const colors = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-purple-100 text-purple-700",
    "bg-rose-100 text-rose-700",
    "bg-cyan-100 text-cyan-700",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">{label}</Label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-12 text-center">
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl">👥</span>
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SecretaryUsersPage() {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const [userId, setUserId] = useState("");
  const [roleCode, setRoleCode] = useState("");

  async function load() {
    const res = await fetch("/api/tenant/secretary/users", { method: "GET" });
    const data = (await res.json().catch(() => ({}))) as UsersResponse;
    if (!res.ok) {
      setUsers([]);
      setError("Failed to load users");
      return;
    }
    setUsers(Array.isArray(data?.users) ? data.users : []);
    setMe(data?.me || null);
    setError(null);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20000);
    return () => clearInterval(timer);
  }, []);

  const canManageRoles = Boolean(me?.permissions?.includes("rbac.user_roles.manage"));

  async function runRoleAction(mode: "assign" | "remove") {
    if (!userId.trim() || !roleCode.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const res = await fetch("/api/tenant/secretary/users/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        user_id: userId.trim(),
        role_code: roleCode.trim(),
      }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(typeof body?.detail === "string" ? body.detail : "Role operation failed");
      return;
    }

    setNotice(`Role "${roleCode.trim()}" ${mode === "assign" ? "assigned to" : "removed from"} user successfully.`);
    setUserId("");
    setRoleCode("");
    await load();
  }

  const activeCount = users.filter((u) => u.is_active).length;
  const inactiveCount = users.length - activeCount;
  const activeRate = users.length > 0 ? Math.round((activeCount / users.length) * 100) : 0;

  const pieData = [
    { name: "active",   value: activeCount },
    { name: "inactive", value: inactiveCount },
  ];

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      (u.full_name ?? "").toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term)
    );
  });

  const selectedUser = users.find((u) => u.id === userId);

  return (
    <AppShell title="Secretary" nav={secretaryNav} activeHref="/tenant/secretary/users">
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">User Operations</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Monitor tenant users and manage role assignments
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm text-blue-100">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{users.length}</div>
                <div className="text-xs">Total Users</div>
              </div>
              <div className="h-8 w-px bg-blue-400" />
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{activeCount}</div>
                <div className="text-xs">Active</div>
              </div>
              <div className="h-8 w-px bg-blue-400" />
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{activeRate}%</div>
                <div className="text-xs">Activity Rate</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Alerts ── */}
        {error && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2"><span>⚠️</span><span>{error}</span></div>
            <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
        {notice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="flex items-center gap-2"><span>✅</span><span>{notice}</span></div>
            <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* ── Chart + Role Panel ── */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* Activity Pie */}
          <SectionCard
            title="User Activity Split"
            subtitle={`${users.length} total users across this tenant`}
          >
            {users.length > 0 ? (
              <div className="flex items-center gap-6">
                <ChartContainer config={chartConfig} className="h-[200px] flex-1">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      strokeWidth={2}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="space-y-4 shrink-0">
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="h-3 w-3 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-slate-500">Active</span>
                    </div>
                    <div className="mt-0.5 text-2xl font-bold text-slate-800">{activeCount}</div>
                    <div className="text-xs text-slate-400">{activeRate}% of total</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="h-3 w-3 rounded-full bg-slate-200 shrink-0" />
                      <span className="text-slate-500">Inactive</span>
                    </div>
                    <div className="mt-0.5 text-2xl font-bold text-slate-800">{inactiveCount}</div>
                    <div className="text-xs text-slate-400">{100 - activeRate}% of total</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-[200px] items-center justify-center text-sm text-slate-400">
                No user data yet
              </div>
            )}
          </SectionCard>

          {/* Role Assignment */}
          <SectionCard
            title="Role Assignment"
            subtitle="Assign or remove roles from tenant users"
          >
            {!canManageRoles ? (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <div className="font-medium">Read-only access</div>
                <div className="mt-0.5 text-xs text-amber-600">
                  You do not have the <code className="rounded bg-amber-100 px-1">rbac.user_roles.manage</code> permission. Contact a director to make role changes.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <FormField label="Select User" hint="Choose from the user list or paste a UUID directly">
                  <select
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    value={userId || "__none__"}
                    onChange={(e) => setUserId(e.target.value === "__none__" ? "" : e.target.value)}
                    disabled={!canManageRoles}
                  >
                    <option value="__none__">Select a user…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name ? `${u.full_name} (${u.email})` : u.email}
                      </option>
                    ))}
                  </select>
                  {/* Or paste UUID */}
                  <Input
                    placeholder="Or paste user UUID directly"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    disabled={!canManageRoles}
                    className="mt-2 text-xs"
                  />
                </FormField>

                {/* Selected user preview */}
                {selectedUser && (
                  <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(selectedUser.id)}`}>
                      {initials(selectedUser.full_name, selectedUser.email)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-blue-900">{selectedUser.full_name || "—"}</div>
                      <div className="text-xs text-blue-500">{selectedUser.email}</div>
                    </div>
                    <div className="ml-auto">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selectedUser.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {selectedUser.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                )}

                <FormField label="Role Code" hint="Common roles: SECRETARY, DIRECTOR, STAFF">
                  <Input
                    placeholder="e.g. SECRETARY"
                    value={roleCode}
                    onChange={(e) => setRoleCode(e.target.value.toUpperCase())}
                    disabled={!canManageRoles}
                  />
                </FormField>

                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={() => void runRoleAction("assign")}
                    disabled={!canManageRoles || busy || !userId.trim() || !roleCode.trim()}
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                  >
                    {busy ? (
                      <span className="flex items-center gap-2">
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Working…
                      </span>
                    ) : "Assign Role"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void runRoleAction("remove")}
                    disabled={!canManageRoles || busy || !userId.trim() || !roleCode.trim()}
                    className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
                  >
                    Remove Role
                  </Button>
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── My Roles ── */}
        {me?.roles && me.roles.length > 0 && (
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-5 py-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your roles:</span>
            {me.roles.map((role) => (
              <span key={role} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
                {role}
              </span>
            ))}
          </div>
        )}

        {/* ── Users Table ── */}
        <SectionCard
          title="Tenant Users"
          subtitle={`${filteredUsers.length} of ${users.length} users`}
          action={
            <div className="w-56">
              <Input
                placeholder="Search name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          }
        >
          <div className="rounded-xl border border-slate-100 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">User</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Record ID</TableHead>
                  {canManageRoles && <TableHead className="text-xs"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((u) => (
                  <TableRow key={u.id} className="hover:bg-slate-50">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(u.id)}`}>
                          {initials(u.full_name, u.email)}
                        </div>
                        <span className="text-sm font-medium text-slate-800">
                          {u.full_name || <span className="text-slate-400 italic">No name</span>}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">{u.email}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.is_active
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-300">{u.id.slice(0, 8)}…</TableCell>
                    {canManageRoles && (
                      <TableCell>
                        <button
                          onClick={() => setUserId(u.id)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                            userId === u.id
                              ? "bg-blue-600 text-white"
                              : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                          }`}
                        >
                          {userId === u.id ? "Selected" : "Select"}
                        </button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {filteredUsers.length === 0 && (
                  <EmptyRow
                    colSpan={canManageRoles ? 5 : 4}
                    message={search ? "No users match your search." : "No users found."}
                  />
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}