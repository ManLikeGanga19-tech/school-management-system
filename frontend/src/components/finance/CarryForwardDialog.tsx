"use client";

/**
 * CarryForwardDialog (a.k.a. "Adjust Balance")
 *
 * A popup card that lets a secretary/director adjust a student's running fee
 * balance — either DEBIT (the student owes more, e.g. paper arrears) or CREDIT
 * (a goodwill bursary, or correcting a known over-bill). System-generated
 * overpayment credits also show up here as read-only entries.
 *
 * Open adjustments are rolled into the next generated fees invoice as a single
 * "Arrears (Brought Forward)" line, signed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Trash2,
  Pencil,
  Plus,
  X,
  ChevronRight,
  History,
  ArrowUpRight,
  ArrowDownRight,
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

export type CarryForwardCategory =
  | "MANUAL_DEBIT"
  | "OVERPAYMENT_CREDIT"
  | "GOODWILL_CREDIT"
  | "OVERBILL_CORRECTION";

export type CarryForwardKind = "DEBIT" | "CREDIT";

export type CarryForwardStatus = "OPEN" | "BUNDLED" | "SETTLED";

export type CarryForwardEntry = {
  id: string;
  student_id: string;
  term_label: string;
  academic_year: number | null;
  term_number: number | null;
  amount: string;       // signed: positive = debit, negative = credit
  description: string;
  category: CarryForwardCategory;
  kind: CarryForwardKind;
  status: CarryForwardStatus;
  invoice_id: string | null;
  created_at: string | null;
};

type AddForm = {
  category: "MANUAL_DEBIT" | "GOODWILL_CREDIT" | "OVERBILL_CORRECTION";
  term_label: string;
  academic_year: string;
  term_number: string;
  amount: string;       // unsigned in the form; signed when submitted
  description: string;
};

type EditForm = {
  category: "MANUAL_DEBIT" | "GOODWILL_CREDIT" | "OVERBILL_CORRECTION";
  term_label: string;
  amount: string;
  description: string;
};

const EMPTY_ADD: AddForm = {
  category: "MANUAL_DEBIT",
  term_label: "",
  academic_year: "",
  term_number: "",
  amount: "",
  description: "",
};

// Categories the user can pick. OVERPAYMENT_CREDIT is system-only — recorded
// automatically when a parent overpays a payment, never manually.
const USER_CATEGORIES: { code: AddForm["category"]; label: string; kind: CarryForwardKind; hint: string }[] = [
  {
    code: "MANUAL_DEBIT",
    label: "Add to balance (debit)",
    kind: "DEBIT",
    hint: "Student owes more — e.g. arrears from paper records, missed payment.",
  },
  {
    code: "GOODWILL_CREDIT",
    label: "Goodwill credit",
    kind: "CREDIT",
    hint: "School is granting the student a credit — bursary, scholarship top-up, discretion.",
  },
  {
    code: "OVERBILL_CORRECTION",
    label: "Correct over-billing (credit)",
    kind: "CREDIT",
    hint: "We over-charged. This credit reduces the student's next invoice.",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtKes(value: string | number): string {
  const n = parseFloat(String(value));
  if (isNaN(n)) return "KES 0.00";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  return `${sign}KES ${abs.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusBadge(status: CarryForwardStatus) {
  if (status === "OPEN")
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">
        Open
      </Badge>
    );
  if (status === "BUNDLED")
    return (
      <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0">
        On invoice
      </Badge>
    );
  return (
    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">
      Settled
    </Badge>
  );
}

function categoryLabel(category: CarryForwardCategory): string {
  switch (category) {
    case "MANUAL_DEBIT":
      return "Manual debit";
    case "OVERPAYMENT_CREDIT":
      return "Overpayment credit (auto)";
    case "GOODWILL_CREDIT":
      return "Goodwill credit";
    case "OVERBILL_CORRECTION":
      return "Over-bill correction";
  }
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

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    category: "MANUAL_DEBIT",
    term_label: "",
    amount: "",
    description: "",
  });
  const [editSaving, setEditSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const res = await api.post<{ data?: { items?: unknown[] } }>(
        "/tenants/secretary/finance/setup",
        {
          action: "list_carry_forward",
          payload: { student_id: studentId },
        },
      );
      const items = ((res.data?.items ?? []) as unknown[]) as CarryForwardEntry[];
      setEntries(items);
    } catch {
      toast.error("Failed to load balance adjustments");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (open && studentId) void load();
  }, [open, studentId, load]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const { openDebit, openCredit, openNet, openCount } = useMemo(() => {
    let debit = 0;
    let credit = 0;
    let count = 0;
    for (const e of entries) {
      if (e.status !== "OPEN") continue;
      const v = parseFloat(e.amount || "0");
      if (v > 0) debit += v;
      else if (v < 0) credit += v; // already negative
      count += 1;
    }
    return { openDebit: debit, openCredit: credit, openNet: debit + credit, openCount: count };
  }, [entries]);

  const selectedCategory = USER_CATEGORIES.find((c) => c.code === addForm.category)!;

  // ── Add ───────────────────────────────────────────────────────────────────
  function updateAdd(field: keyof AddForm, value: string) {
    setAddForm((f) => ({ ...f, [field]: value as AddForm[keyof AddForm] }));
  }

  async function submitAdd() {
    if (!addForm.term_label.trim()) {
      toast.error("Term label is required");
      return;
    }
    const absAmt = parseFloat(addForm.amount);
    if (isNaN(absAmt) || absAmt <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }
    const signedAmt = selectedCategory.kind === "CREDIT" ? -absAmt : absAmt;
    setSaving(true);
    try {
      await api.post("/tenants/secretary/finance/setup", {
        action: "add_carry_forward",
        payload: {
          student_id: studentId,
          category: addForm.category,
          term_label: addForm.term_label.trim(),
          academic_year: addForm.academic_year ? parseInt(addForm.academic_year) : null,
          term_number: addForm.term_number ? parseInt(addForm.term_number) : null,
          amount: signedAmt,
          description: addForm.description.trim() || null,
        },
      });
      toast.success(
        selectedCategory.kind === "CREDIT" ? "Credit recorded" : "Balance added",
      );
      setAddForm(EMPTY_ADD);
      setShowAdd(false);
      await load();
      onChanged?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to save adjustment");
    } finally {
      setSaving(false);
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  function openEdit(entry: CarryForwardEntry) {
    // OVERPAYMENT_CREDIT entries are system-generated; we still allow editing
    // the term label / note but not flipping the category.
    const editableCategory: AddForm["category"] =
      entry.category === "OVERPAYMENT_CREDIT" ? "OVERBILL_CORRECTION" : entry.category;
    setEditingId(entry.id);
    setEditForm({
      category: editableCategory,
      term_label: entry.term_label,
      // Amount in the edit form is unsigned; we re-sign at submit.
      amount: String(Math.abs(parseFloat(entry.amount || "0"))),
      description: entry.description,
    });
  }

  async function submitEdit() {
    if (!editingId) return;
    const absAmt = parseFloat(editForm.amount);
    if (isNaN(absAmt) || absAmt <= 0) {
      toast.error("Amount must be greater than zero");
      return;
    }
    const editKind = USER_CATEGORIES.find((c) => c.code === editForm.category)!.kind;
    const signedAmt = editKind === "CREDIT" ? -absAmt : absAmt;
    setEditSaving(true);
    try {
      await api.post("/tenants/secretary/finance/setup", {
        action: "edit_carry_forward",
        payload: {
          balance_id: editingId,
          category: editForm.category,
          term_label: editForm.term_label.trim(),
          amount: signedAmt,
          description: editForm.description.trim() || "",
        },
      });
      toast.success("Adjustment updated");
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to update adjustment");
    } finally {
      setEditSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      await api.post("/tenants/secretary/finance/setup", {
        action: "delete_carry_forward",
        payload: { balance_id: deletingId },
      });
      toast.success("Adjustment removed");
      setDeletingId(null);
      await load();
      onChanged?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to delete adjustment");
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-blue-600" />
              Adjust Balance
            </DialogTitle>
            <DialogDescription>
              Balance adjustments for <strong>{studentName}</strong>. Open entries
              are rolled into the next generated fees invoice as a single
              &ldquo;Arrears (Brought Forward)&rdquo; line. Every change is recorded in
              the audit log.
            </DialogDescription>
          </DialogHeader>

          {/* ── Pending total banner ──────────────────────────────────── */}
          {openCount > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-amber-700">
                  <ArrowUpRight className="h-3 w-3" /> Debits
                </div>
                <p className="text-sm font-bold text-amber-800 mt-0.5">{fmtKes(openDebit)}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-emerald-700">
                  <ArrowDownRight className="h-3 w-3" /> Credits
                </div>
                <p className="text-sm font-bold text-emerald-800 mt-0.5">{fmtKes(openCredit)}</p>
              </div>
              <div
                className={`rounded-xl px-4 py-3 border ${
                  openNet > 0
                    ? "bg-red-50 border-red-200"
                    : openNet < 0
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-slate-600">
                  <AlertTriangle className="h-3 w-3" /> Net rolled into next invoice
                </div>
                <p
                  className={`text-sm font-bold mt-0.5 ${
                    openNet > 0 ? "text-red-700" : openNet < 0 ? "text-emerald-700" : "text-slate-700"
                  }`}
                >
                  {fmtKes(openNet)}
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
                <p className="text-sm">No balance adjustments recorded</p>
                <p className="text-xs mt-1">
                  Add an entry for any amount owed from prior terms — or record a credit.
                </p>
              </div>
            )}
            {!loading && entries.map((entry) => {
              const amt = parseFloat(entry.amount || "0");
              const isCredit = amt < 0;
              return (
                <div key={entry.id}>
                  {editingId === entry.id ? (
                    /* ── Inline edit row ─────────────────────────────── */
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                        Editing adjustment
                      </p>
                      <div className="space-y-1">
                        <Label className="text-xs">Type</Label>
                        <Select
                          value={editForm.category}
                          onValueChange={(v) => setEditForm((f) => ({ ...f, category: v as AddForm["category"] }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {USER_CATEGORIES.map((c) => (
                              <SelectItem key={c.code} value={c.code}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
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
                            min="0.01"
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
                          <span className="text-[10px] uppercase tracking-wide text-slate-400">
                            {categoryLabel(entry.category)}
                          </span>
                        </div>
                        {entry.description && (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">{entry.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold ${isCredit ? "text-emerald-700" : "text-red-600"}`}>
                          {fmtKes(entry.amount)}
                        </p>
                      </div>
                      {entry.status === "OPEN" && (
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
              );
            })}
          </div>

          {/* ── Add form ──────────────────────────────────────────────── */}
          {showAdd ? (
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/50 p-4 space-y-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                New balance adjustment
              </p>
              <div className="space-y-1">
                <Label className="text-xs">
                  Type <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={addForm.category}
                  onValueChange={(v) => updateAdd("category", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_CATEGORIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-500 mt-0.5">{selectedCategory.hint}</p>
              </div>
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
                    min="0.01"
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
                    placeholder="e.g. Arrears from paper register"
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
                  {saving ? "Saving…" : selectedCategory.kind === "CREDIT" ? "Record Credit" : "Add Debit"}
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
              Adjust Balance (debit or credit)
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
              Remove Adjustment
            </DialogTitle>
            <DialogDescription>
              This will permanently remove this balance adjustment. The action
              is recorded in the audit log. This cannot be undone.
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
