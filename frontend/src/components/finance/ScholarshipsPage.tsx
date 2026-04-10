"use client";

import { useCallback, useEffect, useState } from "react";
import { GraduationCap, Plus, Pencil, Trash2, RefreshCw, Users, ChevronDown, ChevronUp } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import type { AppNavItem } from "@/components/layout/AppShell";
import { TenantPageHeader } from "@/components/tenant/page-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  type Scholarship,
  type ScholarshipAllocation,
  type FinanceSetupData,
  formatAmount,
  toNumber,
  asArray,
  asObject,
  readApiError,
} from "./finance-utils";

type Props = {
  role: "director" | "secretary";
  nav: AppNavItem[];
  activeHref: string;
};

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        active
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-12 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-3xl">🎓</span>
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function perStudentAmount(s: Scholarship): string {
  if (s.type === "PERCENTAGE") return `${toNumber(s.value)}%`;
  if (s.max_recipients && s.max_recipients > 1) {
    const per = toNumber(s.value) / s.max_recipients;
    return `${formatAmount(per)} / student`;
  }
  return formatAmount(s.value);
}

function AllocationRow({
  scholarship,
  apiBase,
}: {
  scholarship: Scholarship;
  apiBase: string;
}) {
  const [open, setOpen] = useState(false);
  const [allocations, setAllocations] = useState<ScholarshipAllocation[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadAllocations() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    try {
      const res = await api.get<{ allocations: ScholarshipAllocation[] }>(
        `/tenants/secretary/finance/scholarships/${scholarship.id}/allocations`,
        { tenantRequired: true }
      );
      setAllocations(asArray<ScholarshipAllocation>((res as any)?.allocations));
    } catch {
      toast.error("Failed to load scholarship allocations.");
    } finally {
      setLoading(false);
    }
  }

  const totalAllocated = allocations.reduce((s, a) => s + toNumber(a.amount), 0);

  return (
    <>
      <TableRow className="hover:bg-slate-50">
        <TableCell className="text-sm font-medium text-slate-800">
          <div>{scholarship.name}</div>
          {scholarship.description && (
            <div className="text-xs text-slate-400 mt-0.5">{scholarship.description}</div>
          )}
        </TableCell>
        <TableCell>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              scholarship.type === "PERCENTAGE"
                ? "bg-purple-50 text-purple-700"
                : "bg-blue-50 text-blue-700"
            }`}
          >
            {scholarship.type === "PERCENTAGE" ? "%" : "KES"}
          </span>
        </TableCell>
        <TableCell>
          <div className="text-sm font-semibold text-slate-700">{perStudentAmount(scholarship)}</div>
          {scholarship.max_recipients && scholarship.max_recipients > 1 && (
            <div className="text-xs text-slate-400">
              Pool: {formatAmount(scholarship.value)} ÷ {scholarship.max_recipients} students
            </div>
          )}
        </TableCell>
        <TableCell>
          <StatusBadge active={scholarship.is_active} />
        </TableCell>
        <TableCell>
          <button
            onClick={() => void loadAllocations()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <Users className="h-3.5 w-3.5" />
            Recipients
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={5} className="bg-slate-50 px-6 pb-4 pt-0">
            {loading ? (
              <div className="py-4 text-center text-xs text-slate-400">Loading recipients…</div>
            ) : allocations.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">
                No students have received this scholarship yet.
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                  <span className="text-xs font-semibold text-slate-600">
                    {allocations.length} recipient{allocations.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-xs text-slate-500">
                    Total distributed: <strong>{formatAmount(totalAllocated)}</strong>
                  </span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Student</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Adm No.</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">Amount</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Invoice</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Reason</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map((a) => (
                      <tr key={a.allocation_id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-2 font-medium text-slate-700">{a.student_name}</td>
                        <td className="px-4 py-2 text-slate-500 font-mono">{a.admission_no || "—"}</td>
                        <td className="px-4 py-2 text-right font-semibold text-emerald-700">
                          {formatAmount(a.amount)}
                        </td>
                        <td className="px-4 py-2 text-slate-500 font-mono">{a.invoice_no || "—"}</td>
                        <td className="px-4 py-2 text-slate-500 max-w-[180px] truncate">{a.reason || "—"}</td>
                        <td className="px-4 py-2 text-slate-400">
                          {a.created_at ? new Date(a.created_at).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function ScholarshipsPage({ role, nav, activeHref }: Props) {
  const apiBase =
    role === "secretary"
      ? "/tenants/secretary/finance/setup"
      : "/tenants/director/finance/setup";
  const readonly = role === "director";

  const [scholarships, setScholarships] = useState<Scholarship[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "PERCENTAGE",
    value: "",
    max_recipients: "",
    description: "",
    is_active: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const body = await api.get<unknown>(apiBase, { tenantRequired: true });
        const obj = asObject(body) ?? {};
        setScholarships(asArray<Scholarship>(obj.scholarships));
      } catch {
        toast.error("Failed to load scholarships.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [apiBase]
  );

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(true), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function postAction(action: string, payload: unknown, successMsg: string) {
    setSaving(true);
    try {
      await api.post<unknown>(
        "/tenants/secretary/finance/setup",
        { action, payload },
        { tenantRequired: true }
      );
      toast.success(successMsg);
      await load(true);
    } catch (err: unknown) {
      toast.error(readApiError(err, "Action failed."));
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setForm({ name: "", type: "PERCENTAGE", value: "", max_recipients: "", description: "", is_active: true });
    setEditingId(null);
    setDialog("create");
  }

  function openEdit(s: Scholarship) {
    setForm({
      name: s.name,
      type: s.type,
      value: String(s.value),
      max_recipients: s.max_recipients ? String(s.max_recipients) : "",
      description: s.description ?? "",
      is_active: s.is_active,
    });
    setEditingId(s.id);
    setDialog("edit");
  }

  async function save() {
    const name = form.name.trim();
    const value = form.value.trim();
    if (!name || !value || toNumber(value) <= 0) {
      toast.error("Name and a valid value (> 0) are required.");
      return;
    }
    const max_recipients = form.max_recipients.trim()
      ? parseInt(form.max_recipients.trim(), 10)
      : null;
    if (max_recipients !== null && (isNaN(max_recipients) || max_recipients < 1)) {
      toast.error("Max recipients must be a positive number.");
      return;
    }
    const payload = {
      name,
      type: form.type,
      value,
      max_recipients,
      description: form.description.trim() || null,
      is_active: form.is_active,
    };
    if (editingId) {
      await postAction(
        "update_scholarship",
        { scholarship_id: editingId, updates: payload },
        "Scholarship updated."
      );
    } else {
      await postAction("create_scholarship", payload, "Scholarship created.");
    }
    setDialog(null);
  }

  async function remove(id: string) {
    await postAction("delete_scholarship", { scholarship_id: id }, "Scholarship deleted.");
    setDeletingId(null);
  }

  if (loading) {
    return (
      <AppShell
        title={role === "director" ? "Director" : "Secretary"}
        nav={nav}
        activeHref={activeHref}
      >
        <div className="flex min-h-[380px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading scholarships…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={role === "director" ? "Director" : "Secretary"}
      nav={nav}
      activeHref={activeHref}
    >
      <div className="space-y-6">
        <TenantPageHeader
          title="Scholarships & Discounts"
          description="Define scholarship templates that can be applied when generating student fee invoices."
          badges={[{ label: "Finance Setup" }]}
          metrics={[
            { label: "Total", value: scholarships.length },
            { label: "Active", value: scholarships.filter((s) => s.is_active).length },
          ]}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          }
        />

        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Scholarships</h2>
                <p className="text-xs text-slate-400">
                  {scholarships.length} scholarship{scholarships.length !== 1 ? "s" : ""} defined
                </p>
              </div>
            </div>
            {!readonly && (
              <Button size="sm" onClick={openCreate} disabled={saving}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Scholarship
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Value / Per Student</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Recipients</TableHead>
                  {!readonly && (
                    <TableHead className="text-right text-xs">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {scholarships.map((s) => (
                  <AllocationRow key={s.id} scholarship={s} apiBase={apiBase} />
                ))}
                {scholarships.length === 0 && (
                  <EmptyRow
                    colSpan={readonly ? 5 : 6}
                    message="No scholarships yet. Create one to apply discounts on student invoices."
                  />
                )}
              </TableBody>
            </Table>
          </div>

          {/* Edit buttons overlay — handled inside AllocationRow; add column here for edit/delete */}
          {!readonly && scholarships.length > 0 && (
            <div className="border-t border-slate-100 px-6 py-3">
              <p className="text-xs text-slate-400">
                Click Recipients to see all students who received each scholarship. Use the edit buttons in the table to modify.
              </p>
            </div>
          )}
        </div>

        {/* Edit / Delete quick actions card */}
        {!readonly && scholarships.length > 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Manage Scholarships</h3>
            </div>
            <div className="divide-y divide-slate-50">
              {scholarships.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <span className="text-sm font-medium text-slate-800">{s.name}</span>
                    <span className="ml-2 text-xs text-slate-400">{perStudentAmount(s)}</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEdit(s)}
                      disabled={saving}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition disabled:opacity-40"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingId(s.id)}
                      disabled={saving}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Create / Edit dialog ── */}
      <Dialog open={dialog !== null} onOpenChange={() => setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "edit" ? "Edit Scholarship" : "New Scholarship"}
            </DialogTitle>
            <DialogDescription>
              Define a scholarship or discount template. For pool scholarships shared among students,
              set Max Recipients and the per-student amount is calculated automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="e.g. Bursary Award, Staff Discount, County Scholarship"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                placeholder="Optional — e.g. County government bursary for needy students"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                    <SelectItem value="FIXED">Fixed Amount (KES)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  {form.type === "FIXED" && form.max_recipients
                    ? "Total Pool Amount (KES)"
                    : `Value ${form.type === "PERCENTAGE" ? "(%)" : "(KES)"}`}{" "}
                  <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  placeholder={form.type === "PERCENTAGE" ? "e.g. 25" : "e.g. 50000"}
                  value={form.value}
                  onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))}
                />
              </div>
            </div>

            {form.type === "FIXED" && (
              <div className="space-y-1.5">
                <Label>Max Recipients (Pool Split)</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 5 — leave blank if full amount per student"
                  value={form.max_recipients}
                  onChange={(e) => setForm((p) => ({ ...p, max_recipients: e.target.value }))}
                />
                {form.max_recipients && form.value && toNumber(form.max_recipients) > 0 && (
                  <p className="text-xs text-blue-600">
                    Per student: {" "}
                    <strong>
                      KES {(toNumber(form.value) / toNumber(form.max_recipients)).toFixed(2)}
                    </strong>
                    {" "} (total pool ÷ {form.max_recipients} students)
                  </p>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : dialog === "edit" ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <Dialog open={deletingId !== null} onOpenChange={() => setDeletingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Scholarship</DialogTitle>
            <DialogDescription>
              This will permanently remove the scholarship definition. Any invoices
              already generated with this scholarship will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && void remove(deletingId)}
              disabled={saving}
            >
              {saving ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
