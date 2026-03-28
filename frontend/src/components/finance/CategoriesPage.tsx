"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Tag, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";

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
  type FeeCategory,
  type FeeItem,
  type FinanceSetupData,
  normalizeCode,
  asArray,
  asObject,
  readApiError,
} from "./finance-utils";

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  role: "director" | "secretary";
  nav: AppNavItem[];
  activeHref: string;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

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
          <span className="text-3xl">📋</span>
          <span className="text-sm text-slate-400">{message}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export function CategoriesPage({ role, nav, activeHref }: Props) {
  const apiBase =
    role === "secretary"
      ? "/tenants/secretary/finance/setup"
      : "/tenants/director/finance/setup";
  const readonly = role === "director";

  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [items, setItems] = useState<FeeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Selected category to filter items
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Category dialog
  const [catDialog, setCatDialog] = useState<"create" | "edit" | null>(null);
  const [catForm, setCatForm] = useState({ code: "", name: "", is_active: true });
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  // Item dialog
  const [itemDialog, setItemDialog] = useState<"create" | "edit" | null>(null);
  const [itemForm, setItemForm] = useState({ category_id: "", code: "", name: "", is_active: true });
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // Delete confirms
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const body = await api.get<unknown>(apiBase, { tenantRequired: true });
        const obj = asObject(body) ?? {};
        setCategories(asArray<FeeCategory>(obj.fee_categories));
        setItems(asArray<FeeItem>(obj.fee_items));
      } catch {
        toast.error("Failed to load categories data.");
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
      toast.error(readApiError(err, "Action failed. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  // ── Category actions ────────────────────────────────────────────────────────

  function openCreateCategory() {
    setCatForm({ code: "", name: "", is_active: true });
    setEditingCatId(null);
    setCatDialog("create");
  }

  function openEditCategory(cat: FeeCategory) {
    setCatForm({ code: cat.code, name: cat.name, is_active: cat.is_active });
    setEditingCatId(cat.id);
    setCatDialog("edit");
  }

  async function saveCategory() {
    const code = normalizeCode(catForm.code);
    const name = catForm.name.trim();
    if (!code || !name) {
      toast.error("Category code and name are required.");
      return;
    }
    if (editingCatId) {
      await postAction(
        "update_fee_category",
        { category_id: editingCatId, updates: { code, name, is_active: catForm.is_active } },
        "Category updated."
      );
    } else {
      await postAction(
        "create_fee_category",
        { code, name, is_active: catForm.is_active },
        "Category created."
      );
    }
    setCatDialog(null);
  }

  async function deleteCategory(id: string) {
    await postAction("delete_fee_category", { category_id: id }, "Category deleted.");
    setDeletingCatId(null);
    if (selectedCategoryId === id) setSelectedCategoryId(null);
  }

  // ── Item actions ────────────────────────────────────────────────────────────

  function openCreateItem(prefillCategoryId?: string) {
    setItemForm({
      category_id: prefillCategoryId ?? selectedCategoryId ?? "",
      code: "",
      name: "",
      is_active: true,
    });
    setEditingItemId(null);
    setItemDialog("create");
  }

  function openEditItem(item: FeeItem) {
    setItemForm({ category_id: item.category_id, code: item.code, name: item.name, is_active: item.is_active });
    setEditingItemId(item.id);
    setItemDialog("edit");
  }

  async function saveItem() {
    const code = normalizeCode(itemForm.code);
    const name = itemForm.name.trim();
    if (!itemForm.category_id || !code || !name) {
      toast.error("Category, item code and name are required.");
      return;
    }
    if (editingItemId) {
      await postAction(
        "update_fee_item",
        { item_id: editingItemId, updates: { category_id: itemForm.category_id, code, name, is_active: itemForm.is_active } },
        "Fee item updated."
      );
    } else {
      await postAction(
        "create_fee_item",
        { category_id: itemForm.category_id, code, name, is_active: itemForm.is_active },
        "Fee item created."
      );
    }
    setItemDialog(null);
  }

  async function deleteItem(id: string) {
    await postAction("delete_fee_item", { item_id: id }, "Fee item deleted.");
    setDeletingItemId(null);
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredItems = selectedCategoryId
    ? items.filter((it) => it.category_id === selectedCategoryId)
    : items;

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

  if (loading) {
    return (
      <AppShell title={role === "director" ? "Director" : "Secretary"} nav={nav} activeHref={activeHref}>
        <div className="flex min-h-[380px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading categories…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={role === "director" ? "Director" : "Secretary"} nav={nav} activeHref={activeHref}>
      <div className="space-y-6">
        <TenantPageHeader
          title="Categories & Items"
          description="Fee categories group related items. Click a category to filter the items table below."
          badges={[{ label: "Finance Setup" }]}
          metrics={[
            { label: "Categories", value: categories.length },
            { label: "Items", value: items.length },
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

        {/* ── Fee Categories ── */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Fee Categories</h2>
                <p className="text-xs text-slate-400">
                  {categories.length} categor{categories.length === 1 ? "y" : "ies"} ·
                  Click a row to filter items below
                </p>
              </div>
            </div>
            {!readonly && (
              <Button size="sm" onClick={openCreateCategory} disabled={saving}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Category
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Code</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Items</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  {!readonly && <TableHead className="text-right text-xs">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => {
                  const isSelected = selectedCategoryId === cat.id;
                  const itemCount = items.filter((i) => i.category_id === cat.id).length;
                  return (
                    <TableRow
                      key={cat.id}
                      onClick={() =>
                        setSelectedCategoryId(isSelected ? null : cat.id)
                      }
                      className={`cursor-pointer transition ${
                        isSelected
                          ? "bg-blue-50 ring-1 ring-inset ring-blue-200"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <TableCell className="font-mono text-xs font-semibold text-blue-700">
                        {cat.code}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-slate-800">
                        {cat.name}
                        {isSelected && (
                          <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                            selected
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">{itemCount}</TableCell>
                      <TableCell>
                        <StatusBadge active={cat.is_active} />
                      </TableCell>
                      {!readonly && (
                        <TableCell className="text-right">
                          <div
                            className="flex justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => openEditCategory(cat)}
                              disabled={saving}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition disabled:opacity-40"
                              title="Edit category"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDeletingCatId(cat.id)}
                              disabled={saving}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-40"
                              title="Delete category"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {categories.length === 0 && (
                  <EmptyRow
                    colSpan={readonly ? 4 : 5}
                    message="No categories yet. Create one to get started."
                  />
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* ── Fee Items ── */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Fee Items
                  {selectedCategory && (
                    <span className="ml-2 font-normal text-slate-400">
                      — {selectedCategory.name}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-400">
                  {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
                  {selectedCategory ? ` in ${selectedCategory.code}` : " total"}
                  {selectedCategory && (
                    <button
                      onClick={() => setSelectedCategoryId(null)}
                      className="ml-2 text-blue-600 hover:underline"
                    >
                      clear filter
                    </button>
                  )}
                </p>
              </div>
            </div>
            {!readonly && (
              <Button
                size="sm"
                onClick={() => openCreateItem()}
                disabled={saving || categories.length === 0}
                title={categories.length === 0 ? "Create a category first" : undefined}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Item
              </Button>
            )}
          </div>

          {!readonly && categories.length === 0 && (
            <div className="mx-6 my-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Create at least one fee category above before adding fee items.
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Code</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  {!readonly && <TableHead className="text-right text-xs">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const cat = categories.find((c) => c.id === item.category_id);
                  return (
                    <TableRow key={item.id} className="hover:bg-slate-50">
                      <TableCell className="font-mono text-xs font-semibold text-blue-700">
                        {item.code}
                      </TableCell>
                      <TableCell className="text-sm text-slate-800">{item.name}</TableCell>
                      <TableCell>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {cat?.code ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge active={item.is_active} />
                      </TableCell>
                      {!readonly && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openEditItem(item)}
                              disabled={saving}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition disabled:opacity-40"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDeletingItemId(item.id)}
                              disabled={saving}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {filteredItems.length === 0 && (
                  <EmptyRow
                    colSpan={readonly ? 4 : 5}
                    message={
                      selectedCategory
                        ? `No items in ${selectedCategory.name} yet.`
                        : "No fee items yet."
                    }
                  />
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* ── Category create/edit dialog ── */}
      <Dialog open={catDialog !== null} onOpenChange={() => setCatDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {catDialog === "edit" ? "Edit Category" : "New Fee Category"}
            </DialogTitle>
            <DialogDescription>
              Categories group related fee items together (e.g. Tuition, Boarding, Activities).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                Category Code <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="e.g. BOARDING"
                value={catForm.code}
                onChange={(e) => setCatForm((p) => ({ ...p, code: e.target.value }))}
              />
              <p className="text-xs text-slate-400">Auto-uppercased. E.g. TUITION</p>
            </div>
            <div className="space-y-1.5">
              <Label>
                Category Name <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="e.g. Boarding Fees"
                value={catForm.name}
                onChange={(e) => setCatForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={catForm.is_active}
                onChange={(e) => setCatForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveCategory()} disabled={saving}>
              {saving ? "Saving…" : catDialog === "edit" ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Item create/edit dialog ── */}
      <Dialog open={itemDialog !== null} onOpenChange={() => setItemDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {itemDialog === "edit" ? "Edit Fee Item" : "New Fee Item"}
            </DialogTitle>
            <DialogDescription>
              Fee items are individual charges within a category.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                Category <span className="text-red-500">*</span>
              </Label>
              <Select
                value={itemForm.category_id || "__none__"}
                onValueChange={(v) =>
                  setItemForm((p) => ({ ...p, category_id: v === "__none__" ? "" : v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select category…</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  Item Code <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="e.g. LUNCH_FEE"
                  value={itemForm.code}
                  onChange={(e) => setItemForm((p) => ({ ...p, code: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Item Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="e.g. Lunch Fee"
                  value={itemForm.name}
                  onChange={(e) => setItemForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={itemForm.is_active}
                onChange={(e) => setItemForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveItem()} disabled={saving}>
              {saving ? "Saving…" : itemDialog === "edit" ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete category confirm ── */}
      <Dialog
        open={deletingCatId !== null}
        onOpenChange={() => setDeletingCatId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Category</DialogTitle>
            <DialogDescription>
              This will permanently delete the category. Items under this category
              will be unlinked. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingCatId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingCatId && void deleteCategory(deletingCatId)}
              disabled={saving}
            >
              {saving ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete item confirm ── */}
      <Dialog
        open={deletingItemId !== null}
        onOpenChange={() => setDeletingItemId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Fee Item</DialogTitle>
            <DialogDescription>
              This will permanently delete the fee item. It will be removed from any
              fee structures that include it. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingItemId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingItemId && void deleteItem(deletingItemId)}
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
