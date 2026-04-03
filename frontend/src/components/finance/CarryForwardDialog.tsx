"use client";

/**
 * CarryForwardDialog
 *
 * A popup card that lets a secretary/director manage a student's
 * outstanding fee balances carried forward from paper records.
 *
 * Features:
 *  - List all carry-forward entries with status badges
 *  - Add new balance (term label, year, term number, amount, optional note)
 *  - Edit amount / label / note for PENDING entries
 *  - Delete PENDING entries with confirmation
 *  - Shows total pending amount prominently
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Trash2,
  Pencil,
  Plus,
  X,
  ChevronRight,
  History,
} from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CarryForwardEntry = {
  id: string;
  student_id: string;
  term_label: string;
  academic_year: number | null;
  term_number: number | null;
  amount: string;
  description: string;
  status: "PENDING" | "INCLUDED" | "CLEARED";
  invoice_id: string | null;
  created_at: string | null;
};

type AddForm = {
  term_label: string;
  academic_year: string;
  term_number: string;
  amount: string;
  description: string;
};

type EditForm = {
  term_label: string;
  amount: string;
  description: string;
};

const EMPTY_ADD: AddForm = {
  term_label: "",
  academic_year: "",
  term_number: "",
  amount: "",
  description: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtKes(value: string | number): string {
  const n = parseFloat(String(value));
  if (isNaN(n)) return "KES 0.00";
  return `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusBadge(status: CarryForwardEntry["status"]) {
  if (status === "PENDING")
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">
        Pending
      </Badge>
    );
  if (status === "INCLUDED")
    return (
      <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0">
        In Invoice
      </Badge>
    );
  return (
    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">
      Cleared
    </Badge>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
  /** Called after any mutation so parent can refresh totals */
  onChanged?: () => void;
};

export function CarryForwardDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
  onChanged,
}: Props) {
  const [entries, setEntries] = useState<CarryForwardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD);
  const [saving, setSaving] = useState(false);

  // Edit form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ term_label: "", amount: "", description: "" });
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const res = await api.post<{ data?: { items?: unknown[] } }>("/secretary/finance/setup", {
        action: "list_carry_forward",
        payload: { student_id: studentId },
      });
      const items = ((res.data?.items ?? []) as unknown[]) as CarryForwardEntry[];
      setEntries(items);
    } catch {
      toast.error("Failed to load carry-forward balances");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (open && studentId) void load();
  }, [open, studentId, load]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const pendingTotal = entries
    .filter((e) => e.status === "PENDING")
    .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);
  const pendingCount = entries.filter((e) => e.status === "PENDING").length;

  // ── Add ───────────────────────────────────────────────────────────────────
  function updateAdd(field: keyof AddForm, value: string) {
    setAddForm((f) => ({ ...f, [field]: value }));
  }

  async function submitAdd() {
    if (!addForm.term_label.trim()) {
      toast.error("Term label is required");
      return;
    }
    const amt = parseFloat(addForm.amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }
    setSaving(true);
    try {
      await api.post("/secretary/finance/setup", {
        action: "add_carry_forward",
        payload: {
          student_id: studentId,
          term_label: addForm.term_label.trim(),
          academic_year: addForm.academic_year ? parseInt(addForm.academic_year) : null,
          term_number: addForm.term_number ? parseInt(addForm.term_number) : null,
          amount: amt,
          description: addForm.description.trim() || null,
        },
      });
      toast.success("Balance recorded successfully");
      setAddForm(EMPTY_ADD);
      setShowAdd(false);
      await load();
      onChanged?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to save balance");
    } finally {
      setSaving(false);
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  function openEdit(entry: CarryForwardEntry) {
    setEditingId(entry.id);
    setEditForm({
      term_label: entry.term_label,
      amount: entry.amount,
      description: entry.description,
    });
  }

  async function submitEdit() {
    if (!editingId) return;
    const amt = parseFloat(editForm.amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }
    setEditSaving(true);
    try {
      await api.post("/secretary/finance/setup", {
        action: "edit_carry_forward",
        payload: {
          balance_id: editingId,
          term_label: editForm.term_label.trim(),
          amount: amt,
          description: editForm.description.trim() || "",
        },
      });
      toast.success("Balance updated");
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to update balance");
    } finally {
      setEditSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      await api.post("/secretary/finance/setup", {
        action: "delete_carry_forward",
        payload: { balance_id: deletingId },
      });
      toast.success("Balance removed");
      setDeletingId(null);
      await load();
      onChanged?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to delete balance");
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Main dialog ─────────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-blue-600" />
              Carry-Forward Balances
            </DialogTitle>
            <DialogDescription>
              Outstanding fee balances for <strong>{studentName}</strong> from previous terms
              or paper records. PENDING balances will be included when you generate a new invoice.
            </DialogDescription>
          </DialogHeader>

          {/* ── Pending total banner ──────────────────────────────────── */}
          {pendingCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800">
                  {pendingCount} pending {pendingCount === 1 ? "balance" : "balances"}
                </p>
                <p className="text-xs text-amber-700">
                  Total outstanding: <strong>{fmtKes(pendingTotal)}</strong>
                </p>
              </div>
            </div>
          )}

          {/* ── Entry list ────────────────────────────────────────────── */}
          <div className="space-y-2">
            {loading && (
              <p className="text-center text-sm text-slate-400 py-6">Loading…</p>
            )}
            {!loading && entries.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No carry-forward balances recorded</p>
                <p className="text-xs mt-1">Add entries for any amounts owed from previous terms</p>
              </div>
            )}
            {!loading && entries.map((entry) => (
              <div key={entry.id}>
                {editingId === entry.id ? (
                  /* ── Inline edit row ─────────────────────────────── */
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Editing balance</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Term Label</Label>
                        <Input
                          value={editForm.term_label}
                          onChange={(e) => setEditForm((f) => ({ ...f, term_label: e.target.value }))}
                          placeholder="e.g. Term 2 2024"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Amount (KES)</Label>
                        <Input
                          type="number"
                          min="1"
                          step="0.01"
                          value={editForm.amount}
                          onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Note (optional)</Label>
                      <Input
                        value={editForm.description}
                        onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                        placeholder="e.g. Arrears from paper records"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)} disabled={editSaving}>
                        <X className="h-3.5 w-3.5" /> Cancel
                      </Button>
                      <Button size="sm" onClick={submitEdit} disabled={editSaving}>
                        {editSaving ? "Saving…" : "Save Changes"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* ── Normal display row ──────────────────────────── */
                  <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800">{entry.term_label}</span>
                        {statusBadge(entry.status)}
                      </div>
                      {entry.description && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{entry.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-red-600">{fmtKes(entry.amount)}</p>
                    </div>
                    {entry.status === "PENDING" && (
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-slate-400 hover:text-blue-600"
                          onClick={() => openEdit(entry)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-slate-400 hover:text-red-600"
                          onClick={() => setDeletingId(entry.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── Add form ──────────────────────────────────────────────── */}
          {showAdd ? (
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/50 p-4 space-y-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                New carry-forward balance
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label className="text-xs">
                    Term Label <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    value={addForm.term_label}
                    onChange={(e) => updateAdd("term_label", e.target.value)}
                    placeholder="e.g. Term 2 2024"
                    autoFocus
                  />
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label className="text-xs">
                    Amount (KES) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    value={addForm.amount}
                    onChange={(e) => updateAdd("amount", e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Academic Year</Label>
                  <Input
                    type="number"
                    value={addForm.academic_year}
                    onChange={(e) => updateAdd("academic_year", e.target.value)}
                    placeholder="e.g. 2024"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Term Number</Label>
                  <Select
                    value={addForm.term_number}
                    onValueChange={(v) => updateAdd("term_number", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select term" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Term 1</SelectItem>
                      <SelectItem value="2">Term 2</SelectItem>
                      <SelectItem value="3">Term 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Note (optional)</Label>
                  <Input
                    value={addForm.description}
                    onChange={(e) => updateAdd("description", e.target.value)}
                    placeholder="e.g. Arrears from paper register — not yet paid"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setShowAdd(false); setAddForm(EMPTY_ADD); }}
                  disabled={saving}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
                <Button size="sm" onClick={submitAdd} disabled={saving}>
                  {saving ? "Saving…" : "Add Balance"}
                  {!saving && <ChevronRight className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full border-dashed"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Carry-Forward Balance
            </Button>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ───────────────────────────────────── */}
      <Dialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-4 w-4" />
              Remove Balance
            </DialogTitle>
            <DialogDescription>
              This will permanently remove this carry-forward entry. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeletingId(null)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteLoading}>
              {deleteLoading ? "Removing…" : "Yes, Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
