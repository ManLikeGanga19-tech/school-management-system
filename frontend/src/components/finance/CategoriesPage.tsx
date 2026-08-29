"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Tag, Plus, Pencil, Trash2, RefreshCw, Rocket, CheckCircle2, ClipboardList } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import type { AppNavItem } from "@/components/layout/AppShell";
import { RowActionsMenu } from "@/components/finance/RowActionsMenu";
import { usePermissions } from "@/lib/auth/usePermissions";
import { useClientPaginatedList } from "@/lib/useClientPaginatedList";
import {
  TablePaginationFooter,
  TableRangeCaption,
} from "@/components/finance/TablePaginationFooter";
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
          : "bg-[var(--tenant-surface-2)] text-[var(--tenant-muted)] ring-1 ring-[var(--tenant-border)]"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-[var(--tenant-muted)]"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-12 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <ClipboardList className="h-7 w-7 text-[var(--tenant-border)]" />
          <span className="text-sm text-[var(--tenant-muted)]">{message}</span>
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
  // Gate edits on the actual permission, not the role the page tree assumes.
  const { has } = usePermissions();
  const readonly = !has("finance.fees.manage");

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

  // Starter template
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [templateDismissed, setTemplateDismissed] = useState(false);

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

  async function handleApplyTemplate() {
    setApplyingTemplate(true);
    try {
      await api.post<unknown>(
        "/tenants/secretary/finance/setup",
        { action: "apply_starter_template", payload: {} },
        { tenantRequired: true }
      );
      toast.success("Starter template loaded! Your fee categories and items are ready.");
      await load(true);
      setTemplateDismissed(true);
    } catch (err: unknown) {
      toast.error(readApiError(err, "Failed to apply template. Please try again."));
    } finally {
      setApplyingTemplate(false);
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredItems = selectedCategoryId
    ? items.filter((it) => it.category_id === selectedCategoryId)
    : items;

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

  // Client-side pagination — categories + items are policy-bounded (dozens,
  // not thousands). Same 30/50/100 UX as invoices/payments but no API
  // round-trip per keystroke.
  const categoriesTable = useClientPaginatedList<FeeCategory, { q: string }>({
    source: categories,
    initialFilters: { q: "" },
    defaultPageSize: 30,
    filterFn: (c, _f, q) =>
      !q || `${c.name} ${c.code}`.toLowerCase().includes(q),
  });
  const itemsTable = useClientPaginatedList<FeeItem, { q: string }>({
    source: filteredItems,
    initialFilters: { q: "" },
    defaultPageSize: 30,
    filterFn: (it, _f, q) =>
      !q || `${it.name} ${it.code}`.toLowerCase().includes(q),
  });

  if (loading) {
    return (
      <AppShell title={role === "director" ? "Director" : "Secretary"} nav={nav} activeHref={activeHref}>
        <div className="flex min-h-[380px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--tenant-primary)] border-t-transparent" />
            <p className="text-sm text-[var(--tenant-muted)]">Loading categories…</p>
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

        {/* ── Starter template banner (shown when no categories exist) ── */}
        {categories.length === 0 && !templateDismissed && (
          <div className="overflow-hidden rounded-2xl border border-[var(--tenant-primary)]/30 bg-gradient-to-br from-[var(--tenant-primary-soft)] to-[var(--tenant-surface-2)] shadow-sm">
            <div className="px-6 py-5 sm:px-8 sm:py-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                {/* Icon */}
                <div className="shrink-0">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--tenant-primary)] text-white shadow-md">
                    <Rocket className="h-6 w-6" />
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-[var(--tenant-ink)]">
                    Get started in seconds — load a starter template
                  </h2>
                  <p className="mt-1 text-sm text-[var(--tenant-primary)]">
                    New to this? We&apos;ve prepared a set of standard fee categories and items used by
                    most Kenyan schools. Load them now and customise later — it takes less than a second.
                  </p>

                  {/* What's included */}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--tenant-primary)]">
                        Categories included
                      </p>
                      <ul className="space-y-1">
                        {[
                          ["SCHOOL_FEES", "School Fees"],
                          ["OTHER", "Other Charges"],
                        ].map(([code, name]) => (
                          <li key={code} className="flex items-center gap-2 text-sm text-[var(--tenant-primary)]">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--tenant-primary)]" />
                            <span className="font-mono text-xs font-semibold">{code}</span>
                            <span className="text-[var(--tenant-muted)]">— {name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--tenant-primary)]">
                        Fee items included
                      </p>
                      <ul className="space-y-1">
                        {[
                          "Tuition Fee",
                          "Activity Fee",
                          "Exam Fee",
                          "Admission Fee",
                        ].map((item) => (
                          <li key={item} className="flex items-center gap-2 text-sm text-[var(--tenant-primary)]">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--tenant-primary)]" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-[var(--tenant-primary)]">
                    You can rename, add, or delete any of these after loading. Nothing is permanent.
                  </p>

                  {/* Actions */}
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      onClick={() => void handleApplyTemplate()}
                      disabled={applyingTemplate}
                      className="flex items-center gap-2 rounded-xl bg-[var(--tenant-primary)] px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-[var(--tenant-primary)] active:scale-95 disabled:opacity-60 transition"
                    >
                      {applyingTemplate ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Loading template…
                        </>
                      ) : (
                        <>
                          <Rocket className="h-4 w-4" />
                          Load Starter Template
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setTemplateDismissed(true)}
                      className="rounded-xl border border-[var(--tenant-primary)]/30 bg-white px-5 py-2.5 text-sm font-medium text-[var(--tenant-primary)] hover:bg-[var(--tenant-primary-soft)] transition"
                    >
                      I&apos;ll set up manually
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Fee Categories ── */}
        <div className="rounded-2xl border border-[var(--tenant-border)] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[var(--tenant-border)] px-4 py-4 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-[var(--tenant-muted)]" />
              <div>
                <h2 className="text-sm font-semibold text-[var(--tenant-ink)]">Fee Categories</h2>
                <p className="text-xs text-[var(--tenant-muted)]">
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
          {categories.length > 5 && (
            <div className="flex flex-col gap-2 border-b border-[var(--tenant-border)] px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
              <Input
                placeholder="Search categories…"
                value={categoriesTable.filters.q}
                onChange={(e) =>
                  categoriesTable.setFilters((p) => ({ ...p, q: e.target.value }))
                }
                className="max-w-xs"
              />
              <span className="text-xs text-[var(--tenant-muted)]">
                <TableRangeCaption meta={categoriesTable.meta} />
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[var(--tenant-surface-2)]">
                  <TableHead className="text-xs">Code</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Items</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  {!readonly && <TableHead className="text-right text-xs">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoriesTable.items.map((cat) => {
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
                          ? "bg-[var(--tenant-primary-soft)] ring-1 ring-inset ring-[var(--tenant-primary)]/25"
                          : "hover:bg-[var(--tenant-surface-2)]"
                      }`}
                    >
                      <TableCell className="font-mono text-xs font-semibold text-[var(--tenant-primary)]">
                        {cat.code}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-[var(--tenant-ink)]">
                        {cat.name}
                        {isSelected && (
                          <span className="ml-2 rounded-full bg-[var(--tenant-primary-soft)] px-1.5 py-0.5 text-xs text-[var(--tenant-primary)]">
                            selected
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--tenant-muted)]">{itemCount}</TableCell>
                      <TableCell>
                        <StatusBadge active={cat.is_active} />
                      </TableCell>
                      {!readonly && (
                        <TableCell className="text-right">
                          <RowActionsMenu
                            ariaLabel="Category actions"
                            actions={[
                              {
                                key: "edit",
                                label: "Edit category",
                                icon: <Pencil />,
                                disabled: saving,
                                onSelect: () => openEditCategory(cat),
                              },
                              {
                                key: "delete",
                                label: "Delete category",
                                icon: <Trash2 />,
                                destructive: true,
                                disabled: saving,
                                separatorBefore: true,
                                onSelect: () => setDeletingCatId(cat.id),
                              },
                            ]}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {categoriesTable.items.length === 0 && (
                  <EmptyRow
                    colSpan={readonly ? 4 : 5}
                    message={
                      categories.length === 0
                        ? "No categories yet. Create one to get started."
                        : "No categories match this search."
                    }
                  />
                )}
              </TableBody>
            </Table>
          </div>
          {categories.length > 30 && (
            <div className="border-t border-[var(--tenant-border)] px-4 py-3">
              <TablePaginationFooter
                meta={categoriesTable.meta}
                page={categoriesTable.page}
                pageSize={categoriesTable.pageSize}
                onPageChange={categoriesTable.setPage}
                onPageSizeChange={categoriesTable.setPageSize}
              />
            </div>
          )}
        </div>

        {/* ── Fee Items ── */}
        <div className="rounded-2xl border border-[var(--tenant-border)] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[var(--tenant-border)] px-4 py-4 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-[var(--tenant-muted)]" />
              <div>
                <h2 className="text-sm font-semibold text-[var(--tenant-ink)]">
                  Fee Items
                  {selectedCategory && (
                    <span className="ml-2 font-normal text-[var(--tenant-muted)]">
                      — {selectedCategory.name}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-[var(--tenant-muted)]">
                  {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
                  {selectedCategory ? ` in ${selectedCategory.code}` : " total"}
                  {selectedCategory && (
                    <button
                      onClick={() => setSelectedCategoryId(null)}
                      className="ml-2 text-[var(--tenant-primary)] hover:underline"
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

          {filteredItems.length > 5 && (
            <div className="flex flex-col gap-2 border-b border-[var(--tenant-border)] px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
              <Input
                placeholder="Search items…"
                value={itemsTable.filters.q}
                onChange={(e) =>
                  itemsTable.setFilters((p) => ({ ...p, q: e.target.value }))
                }
                className="max-w-xs"
              />
              <span className="text-xs text-[var(--tenant-muted)]">
                <TableRangeCaption meta={itemsTable.meta} />
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[var(--tenant-surface-2)]">
                  <TableHead className="text-xs">Code</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  {!readonly && <TableHead className="text-right text-xs">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemsTable.items.map((item) => {
                  const cat = categories.find((c) => c.id === item.category_id);
                  return (
                    <TableRow key={item.id} className="hover:bg-[var(--tenant-surface-2)]">
                      <TableCell className="font-mono text-xs font-semibold text-[var(--tenant-primary)]">
                        {item.code}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--tenant-ink)]">{item.name}</TableCell>
                      <TableCell>
                        <span className="rounded-md bg-[var(--tenant-surface-2)] px-1.5 py-0.5 text-xs text-[var(--tenant-muted)]">
                          {cat?.code ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge active={item.is_active} />
                      </TableCell>
                      {!readonly && (
                        <TableCell className="text-right">
                          <RowActionsMenu
                            ariaLabel="Fee item actions"
                            actions={[
                              {
                                key: "edit",
                                label: "Edit item",
                                icon: <Pencil />,
                                disabled: saving,
                                onSelect: () => openEditItem(item),
                              },
                              {
                                key: "delete",
                                label: "Delete item",
                                icon: <Trash2 />,
                                destructive: true,
                                disabled: saving,
                                separatorBefore: true,
                                onSelect: () => setDeletingItemId(item.id),
                              },
                            ]}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {itemsTable.items.length === 0 && (
                  <EmptyRow
                    colSpan={readonly ? 4 : 5}
                    message={
                      filteredItems.length === 0
                        ? selectedCategory
                          ? `No items in ${selectedCategory.name} yet.`
                          : "No fee items yet."
                        : "No fee items match this search."
                    }
                  />
                )}
              </TableBody>
            </Table>
          </div>
          {filteredItems.length > 30 && (
            <div className="border-t border-[var(--tenant-border)] px-4 py-3">
              <TablePaginationFooter
                meta={itemsTable.meta}
                page={itemsTable.page}
                pageSize={itemsTable.pageSize}
                onPageChange={itemsTable.setPage}
                onPageSizeChange={itemsTable.setPageSize}
              />
            </div>
          )}
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
              <p className="text-xs text-[var(--tenant-muted)]">Auto-uppercased. E.g. TUITION</p>
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
            <label className="flex items-center gap-2 text-sm text-[var(--tenant-ink)]">
              <input
                type="checkbox"
                checked={catForm.is_active}
                onChange={(e) => setCatForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-[var(--tenant-border)] text-[var(--tenant-primary)]"
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
            <label className="flex items-center gap-2 text-sm text-[var(--tenant-ink)]">
              <input
                type="checkbox"
                checked={itemForm.is_active}
                onChange={(e) => setItemForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-[var(--tenant-border)] text-[var(--tenant-primary)]"
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
