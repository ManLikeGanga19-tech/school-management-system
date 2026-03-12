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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from "@/components/ui/alert-dialog";
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
import type { PermissionRow } from "@/lib/admin/rbac";
import {
  createPermission,
  deletePermission,
  listPermissions,
  updatePermission,
} from "@/lib/admin/rbac";
import {
  ShieldCheck,
  Plus,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a category from dot-notation permission code e.g. "finance.invoices.manage" → "Finance" */
function categoryFromCode(code: string): string {
  const first = code.split(".")[0] ?? "general";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Deterministic color per category */
function categoryColor(cat: string): string {
  const map: Record<string, string> = {
    Finance:    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    Enrollment: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    Rbac:       "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
    Tenant:     "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    Audit:      "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    Users:      "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
    Saas:       "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  };
  return map[cat] ?? "bg-slate-100 text-slate-500 ring-1 ring-slate-200";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaaSPermissionsPage() {
  const [rows, setRows]       = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);
  const [q, setQ]             = useState("");

  // Create dialog
  const [openCreate, setOpenCreate] = useState(false);
  const [cCode, setCCode]           = useState("");
  const [cName, setCName]           = useState("");
  const [cDesc, setCDesc]           = useState("");
  const [creating, setCreating]     = useState(false);

  // Edit dialog
  const [openEdit, setOpenEdit] = useState(false);
  const [editRow, setEditRow]   = useState<PermissionRow | null>(null);
  const [eName, setEName]       = useState("");
  const [eDesc, setEDesc]       = useState("");
  const [saving, setSaving]     = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<PermissionRow | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const data = await listPermissions();
      setRows(data ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't load permissions");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // ── Filtered + grouped ────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((p) =>
      `${p.code} ${p.name ?? ""} ${p.description ?? ""}`.toLowerCase().includes(needle)
    );
  }, [rows, q]);

  const grouped = useMemo(() =>
    filtered.reduce((acc, p) => {
      const cat = (p as any).category ?? categoryFromCode(p.code);
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(p);
      return acc;
    }, {} as Record<string, PermissionRow[]>),
    [filtered]
  );

  const categories = Object.keys(grouped).sort();
  const largestCategory = useMemo(() => {
    return categories.reduce<{ name: string; count: number } | null>((largest, category) => {
      const count = grouped[category]?.length ?? 0;
      if (!largest || count > largest.count) return { name: category, count };
      return largest;
    }, null);
  }, [categories, grouped]);

  // ── Create ────────────────────────────────────────────────────────────────

  async function onCreate() {
    const code = cCode.trim();
    const name = cName.trim();
    if (!code) return toast.error("Permission code is required");
    if (!name) return toast.error("Permission name is required");

    setCreating(true);
    try {
      await createPermission({ code, name, description: cDesc.trim() || undefined });
      toast.success("Permission created");
      setOpenCreate(false);
      setCCode(""); setCName(""); setCDesc("");
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create permission");
    } finally {
      setCreating(false);
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  function openEditFor(row: PermissionRow) {
    setEditRow(row);
    setEName(row.name ?? "");
    setEDesc(row.description ?? "");
    setOpenEdit(true);
  }

  async function onSaveEdit() {
    if (!editRow) return;
    const name = eName.trim();
    if (!name) return toast.error("Name is required");
    setSaving(true);
    try {
      await updatePermission(editRow.code, { name, description: eDesc.trim() || undefined });
      toast.success("Permission updated");
      setOpenEdit(false);
      setEditRow(null);
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update permission");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function onDelete(code: string) {
    try {
      await deletePermission(code);
      toast.success("Permission deleted");
      setDeleteTarget(null);
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete permission");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/rbac/permissions">

      {/* ── Create dialog — top level ── */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Permission</DialogTitle>
            <DialogDescription>
              Use dot notation — e.g.{" "}
              <code className="rounded bg-slate-100 px-1">finance.invoices.manage</code>.
              Codes are immutable after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Permission Code <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="e.g. tenants.read_all"
                value={cCode}
                onChange={(e) => setCCode(e.target.value.toLowerCase())}
                className="font-mono"
                onKeyDown={(e) => e.key === "Enter" && void onCreate()}
              />
              <p className="text-xs text-slate-400">
                Lowercase dot notation. Must be globally unique.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Display Name <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="Human-friendly label"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void onCreate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Description</Label>
              <Textarea
                placeholder="What does this permission allow?"
                value={cDesc}
                onChange={(e) => setCDesc(e.target.value)}
                className="resize-none"
                rows={3}
              />
            </div>
            <Separator />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              onClick={() => void onCreate()}
              disabled={creating || !cCode.trim() || !cName.trim()}
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
              ) : "Create Permission"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog — top level ── */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Permission</DialogTitle>
            <DialogDescription>
              Code is immutable:{" "}
              <code className="rounded bg-slate-100 px-1 font-mono">{editRow?.code}</code>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Display Name *</Label>
              <Input
                value={eName}
                onChange={(e) => setEName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void onSaveEdit()}
              />
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
            <Button variant="outline" onClick={() => setOpenEdit(false)} disabled={saving}>Cancel</Button>
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

      {/* ── Delete confirm — top level ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.code}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the permission and cascades to role mappings and user
              overrides. This <strong>cannot be undone</strong>. Ensure no active roles depend on it first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && void onDelete(deleteTarget.code)}
            >
              Delete Permission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Page body ── */}
      <div className="space-y-5">

        {/* Header */}
        <SaasPageHeader
          title="Permission Catalog"
          description="Canonical permission codes used across global roles, tenant roles, and user-level overrides."
          badges={[
            { label: "Super Admin", icon: ShieldCheck },
            { label: "RBAC Permissions", icon: Plus },
          ]}
          metrics={[
            { label: "Total", value: rows.length },
            { label: "Filtered", value: filtered.length },
            { label: "Categories", value: categories.length },
          ]}
        />

        {/* Error */}
        {err && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 shrink-0 text-red-500" />
              {err}
            </div>
            <button onClick={() => setErr(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Stat pills — one per category */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DashboardStatCard label="Permissions" value={rows.length} sub="Full platform catalog" icon={ShieldCheck} tone="accent" />
          <DashboardStatCard label="Filtered View" value={filtered.length} sub={q.trim() ? `Matching "${q}"` : "Current working set"} icon={Search} tone="secondary" />
          <DashboardStatCard label="Categories" value={categories.length} sub="Top-level code families" icon={RefreshCw} tone="sage" />
          <DashboardStatCard
            label="Largest Category"
            value={largestCategory?.name ?? "—"}
            sub={largestCategory ? `${largestCategory.count} permissions in ${largestCategory.name}` : "No permissions loaded"}
            icon={Plus}
            tone="neutral"
          />
        </div>

        {categories.length > 0 && (
          <SaasSurface muted className="flex flex-wrap gap-2 px-4 py-3">
            {categories.map((cat) => (
              <span
                key={cat}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${categoryColor(cat)}`}
              >
                {cat}
                <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-xs font-bold">
                  {grouped[cat].length}
                </span>
              </span>
            ))}
          </SaasSurface>
        )}

        {/* Table card */}
        <SaasSurface className="overflow-hidden">

          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Permissions</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {filtered.length} of {rows.length} permission{rows.length !== 1 ? "s" : ""}
                  {q.trim() ? ` matching "${q}"` : ""}
                  {" · "}grouped by category
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search code, name, description…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="h-8 w-full pl-8 text-xs sm:w-56"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void load(true)}
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
                New Permission
              </Button>
            </div>
          </div>

          {/* Table — grouped by category with sticky headers */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-center">
                <ShieldCheck className="h-8 w-8 text-slate-200" />
                <p className="text-sm text-slate-400">
                  {q.trim() ? `No permissions match "${q}"` : "No permissions found."}
                </p>
                {q.trim() && (
                  <button onClick={() => setQ("")} className="mt-1 text-xs text-blue-500 hover:underline">
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              categories.map((cat) => (
                <div key={cat}>
                  {/* Category header */}
                  <div className={`flex items-center gap-2 border-b border-slate-100 px-6 py-2 ${
                    categoryColor(cat).replace("ring-1", "").replace(/ring-\S+/, "")
                  } bg-opacity-40`}>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${categoryColor(cat)}`}>
                      {cat}
                    </span>
                    <span className="text-xs text-slate-400">
                      {grouped[cat].length} permission{grouped[cat].length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/60 hover:bg-slate-50">
                        <TableHead className="text-xs">Code</TableHead>
                        <TableHead className="text-xs">Name</TableHead>
                        <TableHead className="text-xs">Description</TableHead>
                        <TableHead className="w-20 text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grouped[cat].map((p) => (
                        <TableRow key={p.id} className="hover:bg-slate-50">

                          {/* Code */}
                          <TableCell className="py-3">
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <code className="cursor-default rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
                                    {p.code}
                                  </code>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <span className="font-mono text-xs">ID: {p.id}</span>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>

                          {/* Name */}
                          <TableCell className="py-3">
                            <span className="text-sm font-medium text-slate-800">{p.name}</span>
                          </TableCell>

                          {/* Description */}
                          <TableCell className="max-w-xs py-3">
                            <span className="truncate text-xs text-slate-400">
                              {p.description || "—"}
                            </span>
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="py-3 pr-4">
                            <div className="flex items-center gap-1">
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => openEditFor(p)}
                                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-700"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs">Edit permission</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => setDeleteTarget(p)}
                                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-700"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs">Delete permission</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {filtered.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-6 py-3">
              <span className="text-xs text-slate-400">
                {rows.length} permission{rows.length !== 1 ? "s" : ""} across {categories.length} categor{categories.length !== 1 ? "ies" : "y"}
              </span>
              <span className="text-xs text-slate-400 sm:ml-auto">
                Hover code for full UUID · Codes are immutable after creation
              </span>
            </div>
          )}
        </SaasSurface>
      </div>
    </AppShell>
  );
}
