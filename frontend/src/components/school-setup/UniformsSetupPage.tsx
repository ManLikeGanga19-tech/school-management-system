"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus, Trash2, Pencil, Save, X } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
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
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { normalizeClassOptions, type TenantClassOption } from "@/lib/hr";

type Props = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type UniformRequirement = {
  id: string;
  class_code: string;
  item_name: string;
  description: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  is_mandatory: boolean;
  is_active: boolean;
};

type Draft = {
  item_name: string;
  description: string;
  quantity: string;
  unit_price: string;
  is_mandatory: boolean;
};

const EMPTY: Draft = {
  item_name: "",
  description: "",
  quantity: "1",
  unit_price: "0",
  is_mandatory: true,
};

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function fmtKes(value: unknown): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(num(value));
}

function normalizeRequirement(raw: unknown): UniformRequirement | null {
  const o = asObject(raw);
  if (!o || !str(o.id)) return null;
  return {
    id: str(o.id),
    class_code: str(o.class_code),
    item_name: str(o.item_name),
    description: str(o.description),
    quantity: num(o.quantity),
    unit_price: str(o.unit_price) || "0",
    line_total: str(o.line_total) || "0",
    is_mandatory: o.is_mandatory !== false,
    is_active: o.is_active !== false,
  };
}

export function UniformsSetupPage({ appTitle, nav, activeHref }: Props) {
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [classCode, setClassCode] = useState("");
  const [rows, setRows] = useState<UniformRequirement[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [form, setForm] = useState<Draft>({ ...EMPTY });
  const [editing, setEditing] = useState<Record<string, Draft>>({});

  const loadClasses = useCallback(async () => {
    try {
      const raw = await api.get<unknown>("/tenants/classes", { tenantRequired: true });
      const cls = normalizeClassOptions(raw);
      setClasses(cls);
      setClassCode((c) => c || (cls[0]?.code ?? ""));
    } catch {
      toast.error("Failed to load classes.");
    }
  }, []);

  useEffect(() => { void loadClasses(); }, [loadClasses]);

  const load = useCallback(async () => {
    if (!classCode) { setRows([]); return; }
    setLoading(true);
    try {
      const raw = await api.get<unknown>(
        `/finance/uniform-requirements?class_code=${encodeURIComponent(classCode)}`,
        { tenantRequired: true }
      );
      setRows(
        asArray<unknown>(raw)
          .map(normalizeRequirement)
          .filter((r): r is UniformRequirement => r !== null)
      );
    } catch {
      toast.error("Failed to load uniform requirements.");
    } finally {
      setLoading(false);
    }
  }, [classCode]);

  useEffect(() => { void load(); }, [load]);

  const classTotal = useMemo(
    () => rows.filter((r) => r.is_mandatory).reduce((sum, r) => sum + num(r.line_total), 0),
    [rows]
  );

  async function createItem() {
    if (!classCode) { toast.error("Select a class first."); return; }
    if (!form.item_name.trim()) { toast.error("Uniform item name is required."); return; }
    setSaving(true);
    try {
      await api.post(
        "/finance/uniform-requirements",
        {
          class_code: classCode,
          item_name: form.item_name.trim(),
          description: form.description.trim() || null,
          quantity: Math.max(1, Math.floor(num(form.quantity))),
          unit_price: form.unit_price.trim() || "0",
          is_mandatory: form.is_mandatory,
        },
        { tenantRequired: true }
      );
      toast.success("Uniform item added.");
      setForm({ ...EMPTY });
      await load();
    } catch (err: unknown) {
      const msg = asObject(err)?.message;
      toast.error(typeof msg === "string" ? msg : "Failed to add the uniform item.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(r: UniformRequirement) {
    setEditing((p) => ({
      ...p,
      [r.id]: {
        item_name: r.item_name,
        description: r.description,
        quantity: String(r.quantity),
        unit_price: r.unit_price,
        is_mandatory: r.is_mandatory,
      },
    }));
  }

  function cancelEdit(id: string) {
    setEditing((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  }

  async function saveEdit(id: string) {
    const draft = editing[id];
    if (!draft) return;
    if (!draft.item_name.trim()) { toast.error("Uniform item name is required."); return; }
    setBusyId(id);
    try {
      await api.put(
        `/finance/uniform-requirements/${id}`,
        {
          item_name: draft.item_name.trim(),
          description: draft.description.trim() || null,
          quantity: Math.max(1, Math.floor(num(draft.quantity))),
          unit_price: draft.unit_price.trim() || "0",
          is_mandatory: draft.is_mandatory,
        },
        { tenantRequired: true }
      );
      toast.success("Uniform item updated.");
      cancelEdit(id);
      await load();
    } catch (err: unknown) {
      const msg = asObject(err)?.message;
      toast.error(typeof msg === "string" ? msg : "Failed to update the uniform item.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(r: UniformRequirement) {
    if (!confirm(`Remove "${r.item_name}" from this class's uniform list?`)) return;
    setBusyId(r.id);
    try {
      await api.delete(`/finance/uniform-requirements/${r.id}`, undefined, { tenantRequired: true });
      toast.success("Uniform item removed.");
      await load();
    } catch {
      toast.error("Failed to remove the uniform item.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">School Setup · Uniforms</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Set each class&apos;s uniform requirements. Mandatory items are billed
                automatically when you generate that class&apos;s fees invoice.
              </p>
            </div>
            <Button
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void load()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="dashboard-surface rounded-[1.6rem] p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-60 space-y-1.5">
              <Label className="text-xs">Class</Label>
              <Select value={classCode} onValueChange={setClassCode}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select class…" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.code}>
                      {c.name || c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Mandatory uniform total
              </div>
              <div className="text-base font-bold text-slate-900">{fmtKes(classTotal)}</div>
            </div>
          </div>
        </div>

        {/* Add item */}
        <div className="dashboard-surface rounded-[1.6rem] p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Add Uniform Item</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5 lg:col-span-1">
              <Label className="text-xs">Item</Label>
              <Input
                value={form.item_name}
                onChange={(e) => setForm((p) => ({ ...p, item_name: e.target.value }))}
                placeholder="e.g. Sweater"
              />
            </div>
            <div className="space-y-1.5 lg:col-span-1">
              <Label className="text-xs">Details (size, colour)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Quantity</Label>
              <Input
                type="number"
                min={1}
                value={form.quantity}
                onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unit price (KES)</Label>
              <Input
                type="number"
                min={0}
                value={form.unit_price}
                onChange={(e) => setForm((p) => ({ ...p, unit_price: e.target.value }))}
              />
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_mandatory}
                  onChange={(e) => setForm((p) => ({ ...p, is_mandatory: e.target.checked }))}
                />
                Mandatory
              </label>
              <Button className="h-9" onClick={() => void createItem()} disabled={saving || !classCode}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="dashboard-surface overflow-hidden rounded-[1.6rem]">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">Details</TableHead>
                  <TableHead className="text-right text-xs">Qty</TableHead>
                  <TableHead className="text-right text-xs">Unit Price</TableHead>
                  <TableHead className="text-right text-xs">Line Total</TableHead>
                  <TableHead className="text-xs">Billing</TableHead>
                  <TableHead className="text-right text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">Loading…</TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">
                      No uniform items for this class yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const draft = editing[r.id];
                    if (draft) {
                      return (
                        <TableRow key={r.id} className="bg-amber-50/40">
                          <TableCell>
                            <Input
                              className="h-8 text-sm"
                              value={draft.item_name}
                              onChange={(e) => setEditing((p) => ({ ...p, [r.id]: { ...draft, item_name: e.target.value } }))}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-8 text-sm"
                              value={draft.description}
                              onChange={(e) => setEditing((p) => ({ ...p, [r.id]: { ...draft, description: e.target.value } }))}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={1}
                              className="h-8 w-20 text-sm"
                              value={draft.quantity}
                              onChange={(e) => setEditing((p) => ({ ...p, [r.id]: { ...draft, quantity: e.target.value } }))}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              className="h-8 w-28 text-sm"
                              value={draft.unit_price}
                              onChange={(e) => setEditing((p) => ({ ...p, [r.id]: { ...draft, unit_price: e.target.value } }))}
                            />
                          </TableCell>
                          <TableCell className="text-right text-xs text-slate-400">—</TableCell>
                          <TableCell>
                            <label className="flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={draft.is_mandatory}
                                onChange={(e) => setEditing((p) => ({ ...p, [r.id]: { ...draft, is_mandatory: e.target.checked } }))}
                              />
                              Mandatory
                            </label>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" className="h-7 text-xs" onClick={() => void saveEdit(r.id)} disabled={busyId === r.id}>
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => cancelEdit(r.id)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm font-medium">{r.item_name}</TableCell>
                        <TableCell className="text-xs text-slate-500">{r.description || "—"}</TableCell>
                        <TableCell className="text-right text-sm">{r.quantity}</TableCell>
                        <TableCell className="text-right text-sm">{fmtKes(r.unit_price)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{fmtKes(r.line_total)}</TableCell>
                        <TableCell>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              r.is_mandatory
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {r.is_mandatory ? "Mandatory" : "Optional"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startEdit(r)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-red-600 hover:bg-red-50"
                              onClick={() => void remove(r)}
                              disabled={busyId === r.id}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          When you generate a class&apos;s fees invoice, tick &quot;Include uniforms&quot; to add the
          mandatory items above as invoice lines. Optional items are recorded for reference only.
        </p>
      </div>
    </AppShell>
  );
}
