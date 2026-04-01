"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileSpreadsheet,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  ChevronRight,
  X,
  Package,
  Download,
} from "lucide-react";

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
  type FeeStructure,
  type FeeStructureItem,
  type FeeItem,
  type FeeCategory,
  type StudentType,
  formatAmount,
  toNumber,
  normalizeClassCode,
  asArray,
  asObject,
  readApiError,
} from "./finance-utils";

type Props = {
  role: "director" | "secretary";
  nav: AppNavItem[];
  activeHref: string;
};

const CURRENT_YEAR = new Date().getFullYear();

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

function StudentTypeBadge({ type }: { type: StudentType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        type === "NEW"
          ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
          : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      }`}
    >
      {type === "NEW" ? "New" : "Returning"}
    </span>
  );
}

function FreqBadge({ freq }: { freq: string }) {
  if (freq === "ONCE_PER_YEAR") return <span className="text-xs text-amber-600">Once/yr</span>;
  if (freq === "ONCE_EVER") return <span className="text-xs text-purple-600">One-time</span>;
  return <span className="text-xs text-slate-400">Per term</span>;
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center">
        <span className="text-sm text-slate-400">{message}</span>
      </TableCell>
    </TableRow>
  );
}

export function FeeStructuresPage({ role, nav, activeHref }: Props) {
  const apiBase =
    role === "secretary"
      ? "/tenants/secretary/finance/setup"
      : "/tenants/director/finance/setup";
  const canManage = role === "director";

  // ── Data ────────────────────────────────────────────────────────────────────
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [structureItems, setStructureItems] = useState<Record<string, FeeStructureItem[]>>({});
  const [feeItems, setFeeItems] = useState<FeeItem[]>([]);
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Selection ───────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Structure CRUD dialogs ───────────────────────────────────────────────────
  const [structureDialog, setStructureDialog] = useState<"create" | "edit" | null>(null);
  const [structureForm, setStructureForm] = useState({
    name: "",
    class_code: "",
    academic_year: String(CURRENT_YEAR),
    student_type: "NEW" as StudentType,
    is_active: true,
  });
  const [editingStructureId, setEditingStructureId] = useState<string | null>(null);
  const [deletingStructureId, setDeletingStructureId] = useState<string | null>(null);

  // ── Add item to structure ────────────────────────────────────────────────────
  const [addItemForm, setAddItemForm] = useState({
    fee_item_id: "",
    term_1_amount: "",
    term_2_amount: "",
    term_3_amount: "",
  });
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);

  // ── PDF download ──────────────────────────────────────────────────────────────
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────────
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const body = await api.get<unknown>(apiBase, { tenantRequired: true });
        const obj = asObject(body) ?? {};
        setStructures(asArray<FeeStructure>(obj.fee_structures));
        setStructureItems(
          (asObject(obj.fee_structure_items) ?? {}) as Record<string, FeeStructureItem[]>
        );
        setFeeItems(asArray<FeeItem>(obj.fee_items));
        setCategories(asArray<FeeCategory>(obj.fee_categories));
      } catch {
        toast.error("Failed to load fee structures.");
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

  // ── Post helper ──────────────────────────────────────────────────────────────
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

  // ── Structure CRUD ───────────────────────────────────────────────────────────
  function openCreateStructure() {
    setStructureForm({
      name: "",
      class_code: "",
      academic_year: String(CURRENT_YEAR),
      student_type: "NEW",
      is_active: true,
    });
    setEditingStructureId(null);
    setStructureDialog("create");
  }

  function openEditStructure(s: FeeStructure) {
    setStructureForm({
      name: s.name,
      class_code: s.class_code,
      academic_year: String(s.academic_year),
      student_type: s.student_type,
      is_active: s.is_active,
    });
    setEditingStructureId(s.id);
    setStructureDialog("edit");
  }

  async function saveStructure() {
    const name = structureForm.name.trim();
    const class_code = normalizeClassCode(structureForm.class_code);
    const academic_year = parseInt(structureForm.academic_year, 10);
    if (!name || !class_code) {
      toast.error("Name and Class Code are required.");
      return;
    }
    if (!academic_year || academic_year < 2000 || academic_year > 2100) {
      toast.error("Enter a valid academic year (e.g. 2026).");
      return;
    }

    if (editingStructureId) {
      await postAction(
        "update_fee_structure",
        {
          structure_id: editingStructureId,
          updates: {
            name,
            class_code,
            academic_year,
            student_type: structureForm.student_type,
            is_active: structureForm.is_active,
          },
        },
        "Fee structure updated."
      );
    } else {
      await postAction(
        "create_fee_structure",
        {
          name,
          class_code,
          academic_year,
          student_type: structureForm.student_type,
          is_active: structureForm.is_active,
        },
        "Fee structure created."
      );
    }
    setStructureDialog(null);
  }

  async function deleteStructure(id: string) {
    await postAction("delete_fee_structure", { structure_id: id }, "Fee structure deleted.");
    setDeletingStructureId(null);
    if (selectedId === id) setSelectedId(null);
  }

  // ── Items management ─────────────────────────────────────────────────────────
  const selectedItems: FeeStructureItem[] = selectedId ? (structureItems[selectedId] ?? []) : [];

  const availableItems = feeItems.filter(
    (fi) => fi.is_active && !selectedItems.some((si) => si.fee_item_id === fi.id)
  );

  function handleSelectFeeItem(feeItemId: string) {
    const fi = feeItems.find((f) => f.id === feeItemId);
    if (!fi) return;
    // Pre-fill: ONCE_PER_YEAR / ONCE_EVER get T2/T3 = 0
    setAddItemForm((p) => ({
      ...p,
      fee_item_id: feeItemId,
      term_2_amount: fi.charge_frequency !== "PER_TERM" ? "0" : p.term_2_amount,
      term_3_amount: fi.charge_frequency !== "PER_TERM" ? "0" : p.term_3_amount,
    }));
  }

  async function addItem() {
    if (!selectedId) return;
    const { fee_item_id, term_1_amount, term_2_amount, term_3_amount } = addItemForm;
    if (!fee_item_id) {
      toast.error("Select a fee item.");
      return;
    }
    await postAction(
      "add_structure_item",
      {
        structure_id: selectedId,
        item: {
          fee_item_id,
          term_1_amount: toNumber(term_1_amount),
          term_2_amount: toNumber(term_2_amount),
          term_3_amount: toNumber(term_3_amount),
        },
      },
      "Item added to structure."
    );
    setAddItemForm({ fee_item_id: "", term_1_amount: "", term_2_amount: "", term_3_amount: "" });
  }

  async function removeItem(feeItemId: string) {
    if (!selectedId) return;
    await postAction(
      "remove_structure_item",
      { structure_id: selectedId, fee_item_id: feeItemId },
      "Item removed."
    );
    setRemovingItemId(null);
  }

  // ── PDF download ──────────────────────────────────────────────────────────────
  async function downloadStructurePdf(structureId: string) {
    setDownloadingId(structureId);
    try {
      await api.downloadFile(
        `/finance/documents/fee-structures/${structureId}/pdf`,
        `fee-structure-${structureId}.pdf`,
        { tenantRequired: true }
      );
    } catch {
      toast.error("Failed to download PDF.");
    } finally {
      setDownloadingId(null);
    }
  }

  // ── Derived helpers ──────────────────────────────────────────────────────────
  const selectedStructure = structures.find((s) => s.id === selectedId) ?? null;
  const categoryName = (categoryId: string) =>
    categories.find((c) => c.id === categoryId)?.name ?? categoryId;

  const structureTotal1 = (id: string) =>
    (structureItems[id] ?? []).reduce((sum, i) => sum + toNumber(i.term_1_amount), 0);

  // ── Loading state ─────────────────────────────────────────────────────────────
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
            <p className="text-sm text-slate-500">Loading fee structures…</p>
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
          title="Fee Structures"
          description="Define per-class fee structures (academic year + student type) with per-term amounts."
          badges={[{ label: "Finance Setup" }]}
          metrics={[
            { label: "Total", value: structures.length },
            { label: "Active", value: structures.filter((s) => s.is_active).length },
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

        {/* ── Structures table ── */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Fee Structures</h2>
                <p className="text-xs text-slate-400">
                  {structures.length} structure{structures.length !== 1 ? "s" : ""} defined
                  {selectedId && <span className="ml-1.5 text-blue-500">· 1 selected</span>}
                </p>
              </div>
            </div>
            {canManage && (
              <Button size="sm" onClick={openCreateStructure} disabled={saving}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Structure
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Class</TableHead>
                  <TableHead className="text-xs">Year</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Items</TableHead>
                  <TableHead className="text-xs">Term 1 Total</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-right text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {structures.map((s) => {
                  const isSelected = selectedId === s.id;
                  const itemCount = (structureItems[s.id] ?? []).length;
                  return (
                    <TableRow
                      key={s.id}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? "bg-blue-50 hover:bg-blue-50" : "hover:bg-slate-50"
                      }`}
                      onClick={() => setSelectedId(isSelected ? null : s.id)}
                    >
                      <TableCell className="text-sm font-medium text-slate-800">
                        <div className="flex items-center gap-1.5">
                          <ChevronRight
                            className={`h-3.5 w-3.5 transition-transform text-blue-400 ${
                              isSelected ? "rotate-90" : ""
                            }`}
                          />
                          {s.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-mono font-medium text-slate-700">
                          {s.class_code}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{s.academic_year}</TableCell>
                      <TableCell>
                        <StudentTypeBadge type={s.student_type} />
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {itemCount} item{itemCount !== 1 ? "s" : ""}
                      </TableCell>
                      <TableCell className="text-sm font-semibold text-slate-700">
                        {formatAmount(structureTotal1(s.id))}
                      </TableCell>
                      <TableCell>
                        <StatusBadge active={s.is_active} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div
                          className="flex justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => void downloadStructurePdf(s.id)}
                            disabled={downloadingId === s.id}
                            title="Download PDF"
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition disabled:opacity-40"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          {canManage && (
                            <>
                              <button
                                onClick={() => openEditStructure(s)}
                                disabled={saving}
                                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition disabled:opacity-40"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeletingStructureId(s.id)}
                                disabled={saving}
                                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setSelectedId(isSelected ? null : s.id)}
                            className={`rounded-md p-1.5 text-xs font-medium transition ${
                              isSelected
                                ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                                : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            }`}
                          >
                            <Package className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {structures.length === 0 && (
                  <EmptyRow
                    colSpan={8}
                    message="No fee structures yet. Create one to start defining fee line items per class."
                  />
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* ── Items panel ── */}
        {selectedId && selectedStructure && (
          <div className="rounded-2xl border border-blue-100 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50/40 px-6 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Items — <span className="text-blue-700">{selectedStructure.name}</span>
                </h2>
                <p className="text-xs text-slate-500">
                  Class{" "}
                  <span className="font-mono font-medium">{selectedStructure.class_code}</span>
                  {" · "}
                  {selectedStructure.academic_year}
                  {" · "}
                  <StudentTypeBadge type={selectedStructure.student_type} />
                  {" · "}
                  {selectedItems.length} item{selectedItems.length !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-blue-100 hover:text-slate-700 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs">Fee Item</TableHead>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs">Frequency</TableHead>
                    <TableHead className="text-xs">Term 1</TableHead>
                    <TableHead className="text-xs">Term 2</TableHead>
                    <TableHead className="text-xs">Term 3</TableHead>
                    {canManage && <TableHead className="text-right text-xs">Remove</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedItems.map((item) => (
                    <TableRow key={item.fee_item_id} className="hover:bg-slate-50">
                      <TableCell className="text-sm font-medium text-slate-800">
                        {item.fee_item_name}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {item.category_name || categoryName(item.category_id)}
                      </TableCell>
                      <TableCell>
                        <FreqBadge freq={item.charge_frequency} />
                      </TableCell>
                      <TableCell className="text-sm font-medium text-slate-700">
                        {formatAmount(item.term_1_amount)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {item.charge_frequency === "PER_TERM"
                          ? formatAmount(item.term_2_amount)
                          : <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {item.charge_frequency === "PER_TERM"
                          ? formatAmount(item.term_3_amount)
                          : <span className="text-slate-300">—</span>}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <button
                            onClick={() => setRemovingItemId(item.fee_item_id)}
                            disabled={saving}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {selectedItems.length === 0 && (
                    <EmptyRow
                      colSpan={canManage ? 7 : 6}
                      message="No items in this structure yet."
                    />
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Add item row */}
            {canManage && (
              <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                <p className="mb-3 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Add Item
                </p>
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Fee Item</Label>
                    <Select
                      value={addItemForm.fee_item_id}
                      onValueChange={handleSelectFeeItem}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select fee item…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableItems.length === 0 ? (
                          <SelectItem value="__none__" disabled>
                            All fee items already added
                          </SelectItem>
                        ) : (
                          availableItems.map((fi) => {
                            const cat = categories.find((c) => c.id === fi.category_id);
                            return (
                              <SelectItem key={fi.id} value={fi.id}>
                                {fi.name}
                                {cat ? ` (${cat.name})` : ""}
                                {fi.charge_frequency !== "PER_TERM"
                                  ? ` — ${fi.charge_frequency === "ONCE_PER_YEAR" ? "once/yr" : "one-time"}`
                                  : ""}
                              </SelectItem>
                            );
                          })
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  {(["term_1_amount", "term_2_amount", "term_3_amount"] as const).map(
                    (col, idx) => {
                      const selectedFeeItem = feeItems.find(
                        (fi) => fi.id === addItemForm.fee_item_id
                      );
                      const isDisabled =
                        selectedFeeItem?.charge_frequency !== "PER_TERM" && idx > 0;
                      return (
                        <div key={col} className="w-28 space-y-1.5">
                          <Label className="text-xs">Term {idx + 1} (KES)</Label>
                          <Input
                            type="number"
                            min={0}
                            placeholder="0"
                            className="h-8 text-sm"
                            disabled={isDisabled}
                            value={isDisabled ? "0" : addItemForm[col]}
                            onChange={(e) =>
                              setAddItemForm((p) => ({ ...p, [col]: e.target.value }))
                            }
                          />
                        </div>
                      );
                    }
                  )}
                  <Button
                    size="sm"
                    onClick={() => void addItem()}
                    disabled={saving || !addItemForm.fee_item_id}
                    className="h-8"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Create / Edit structure dialog ── */}
      <Dialog open={structureDialog !== null} onOpenChange={() => setStructureDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {structureDialog === "edit" ? "Edit Fee Structure" : "New Fee Structure"}
            </DialogTitle>
            <DialogDescription>
              Create a fee structure for a specific class, academic year, and student type (New or Returning).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="e.g. PP1 New Student Fees 2026"
                value={structureForm.name}
                onChange={(e) => setStructureForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  Class Code <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="e.g. PP1"
                  value={structureForm.class_code}
                  onChange={(e) =>
                    setStructureForm((p) => ({ ...p, class_code: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Academic Year <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="number"
                  min={2000}
                  max={2100}
                  placeholder={String(CURRENT_YEAR)}
                  value={structureForm.academic_year}
                  onChange={(e) =>
                    setStructureForm((p) => ({ ...p, academic_year: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Student Type</Label>
              <Select
                value={structureForm.student_type}
                onValueChange={(v) =>
                  setStructureForm((p) => ({ ...p, student_type: v as StudentType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NEW">New Student (admitted this year)</SelectItem>
                  <SelectItem value="RETURNING">Returning Student (admitted previously)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={structureForm.is_active}
                onChange={(e) =>
                  setStructureForm((p) => ({ ...p, is_active: e.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStructureDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveStructure()} disabled={saving}>
              {saving ? "Saving…" : structureDialog === "edit" ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete structure confirm ── */}
      <Dialog
        open={deletingStructureId !== null}
        onOpenChange={() => setDeletingStructureId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Fee Structure</DialogTitle>
            <DialogDescription>
              This will permanently delete the fee structure and all its line items. Invoices
              already generated are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingStructureId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingStructureId && void deleteStructure(deletingStructureId)}
              disabled={saving}
            >
              {saving ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove item confirm ── */}
      <Dialog open={removingItemId !== null} onOpenChange={() => setRemovingItemId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Item</DialogTitle>
            <DialogDescription>
              Remove this fee item from the structure? The fee item itself is not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovingItemId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removingItemId && void removeItem(removingItemId)}
              disabled={saving}
            >
              {saving ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
