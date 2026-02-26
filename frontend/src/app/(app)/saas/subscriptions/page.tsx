"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CreditCard,
  Search,
  RefreshCw,
  Plus,
  XCircle,
  CheckCircle,
  AlertTriangle,
  CalendarDays,
  Calendar,
  Building2,
  Pencil,
  Trash2,
  BadgePercent,
  TrendingUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type BillingCycle = "per_term" | "full_year";
type SubStatus    = "active" | "trialing" | "past_due" | "cancelled" | "paused";

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  tenant_slug?: string;
  plan: string;
  billing_cycle: BillingCycle;
  status: SubStatus;
  amount_kes: number;
  discount_percent?: number | null;
  /** ISO date — when the current period started */
  period_start?: string | null;
  /** ISO date — when the current period ends / next payment due */
  period_end?: string | null;
  /** ISO date — when the subscription was created */
  created_at?: string | null;
  /** Any admin notes */
  notes?: string | null;
};

type TenantOption = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PLANS   = ["Starter", "Basic", "Professional", "Enterprise"];
const STATUSES: SubStatus[] = ["active", "trialing", "past_due", "cancelled", "paused"];

/**
 * Base pricing per plan per term (KES).
 * Full-year = term price × 3 × (1 - discount).
 * Adjust these to match your actual pricing.
 */
const BASE_TERM_PRICE: Record<string, number> = {
  Starter:      5_000,
  Basic:        12_000,
  Professional: 25_000,
  Enterprise:   50_000,
};

// ─── Nav ──────────────────────────────────────────────────────────────────────

const nav = [
  { href: "/saas/dashboard",        label: "SaaS Summary"  },
  { href: "/saas/tenants",          label: "Tenants"       },
  { href: "/saas/subscriptions",    label: "Subscriptions" },
  { href: "/saas/rbac/permissions", label: "Permissions"   },
  { href: "/saas/rbac/roles",       label: "Roles"         },
  { href: "/saas/audit",            label: "Audit Logs"    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatKes(v: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency", currency: "KES", maximumFractionDigits: 0,
  }).format(v);
}

function timeAgo(iso?: string | null) {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function statusStyle(s: SubStatus) {
  return {
    active:    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    trialing:  "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    past_due:  "bg-red-50 text-red-700 ring-1 ring-red-200",
    cancelled: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    paused:    "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  }[s];
}

function statusDot(s: SubStatus) {
  return {
    active:    "bg-emerald-500",
    trialing:  "bg-blue-500",
    past_due:  "bg-red-500",
    cancelled: "bg-slate-400",
    paused:    "bg-amber-500",
  }[s];
}

function billingLabel(cycle: BillingCycle) {
  return cycle === "per_term" ? "Per Term" : "Full Year";
}

function billingIcon(cycle: BillingCycle) {
  return cycle === "per_term" ? CalendarDays : Calendar;
}

function computeAmount(plan: string, cycle: BillingCycle, discount: number): number {
  const termBase = BASE_TERM_PRICE[plan] ?? 0;
  if (cycle === "per_term") return Math.round(termBase * (1 - discount / 100));
  return Math.round(termBase * 3 * (1 - discount / 100));
}

function avatarColor(id: string) {
  const p = [
    "bg-blue-100 text-blue-700", "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700", "bg-purple-100 text-purple-700",
    "bg-rose-100 text-rose-700",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return p[Math.abs(h) % p.length];
}

// ─── Backend patch functions ──────────────────────────────────────────────────

/**
 * TODO: GET /api/v1/admin/subscriptions
 * Query params: status?, tenant_id?, plan?, billing_cycle?
 * Returns: SubscriptionRow[]
 */
async function fetchSubscriptions(params: Record<string, string>): Promise<SubscriptionRow[]> {
  const qs = new URLSearchParams(params).toString();
  return apiFetch<SubscriptionRow[]>(`/admin/subscriptions?${qs}`, {
    method: "GET", tenantRequired: false,
  });
}

/**
 * TODO: POST /api/v1/admin/subscriptions
 * Body: { tenant_id, plan, billing_cycle, discount_percent?, notes?, period_start? }
 * Returns: SubscriptionRow
 */
async function createSubscription(body: object): Promise<void> {
  await apiFetch("/admin/subscriptions", {
    method: "POST", tenantRequired: false,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  } as any);
}

/**
 * TODO: PATCH /api/v1/admin/subscriptions/:id
 * Body: { plan?, billing_cycle?, status?, discount_percent?, notes? }
 * Returns: SubscriptionRow
 */
async function updateSubscription(id: string, body: object): Promise<void> {
  await apiFetch(`/admin/subscriptions/${id}`, {
    method: "PATCH", tenantRequired: false,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  } as any);
}

/**
 * TODO: DELETE /api/v1/admin/subscriptions/:id
 */
async function cancelSubscription(id: string): Promise<void> {
  await apiFetch(`/admin/subscriptions/${id}`, {
    method: "DELETE", tenantRequired: false,
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SaaSSubscriptionsPage() {
  const [rows, setRows]       = useState<SubscriptionRow[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);

  // Filters
  const [filterStatus,  setFilterStatus]  = useState<string>("all");
  const [filterPlan,    setFilterPlan]    = useState<string>("all");
  const [filterCycle,   setFilterCycle]   = useState<string>("all");
  const [filterTenant,  setFilterTenant]  = useState<string>("all");
  const [q, setQ]                         = useState("");

  // Create dialog
  const [createOpen, setCreateOpen]     = useState(false);
  const [cTenant, setCTenant]           = useState("");
  const [cPlan, setCPlan]               = useState("Basic");
  const [cCycle, setCCycle]             = useState<BillingCycle>("per_term");
  const [cDiscount, setCDiscount]       = useState("0");
  const [cNotes, setCNotes]             = useState("");
  const [cPeriodStart, setCPeriodStart] = useState("");
  const [creating, setCreating]         = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen]   = useState(false);
  const [editRow, setEditRow]     = useState<SubscriptionRow | null>(null);
  const [ePlan, setEPlan]         = useState("");
  const [eCycle, setECycle]       = useState<BillingCycle>("per_term");
  const [eStatus, setEStatus]     = useState<SubStatus>("active");
  const [eDiscount, setEDiscount] = useState("0");
  const [eNotes, setENotes]       = useState("");
  const [saving, setSaving]       = useState(false);

  // Cancel confirm
  const [cancelTarget, setCancelTarget] = useState<SubscriptionRow | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────

  async function loadTenants() {
    try {
      const data = await apiFetch<TenantOption[]>("/admin/tenants", {
        method: "GET", tenantRequired: false,
      });
      setTenants(data ?? []);
    } catch { setTenants([]); }
  }

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const params: Record<string, string> = {};
      if (filterStatus !== "all")  params.status        = filterStatus;
      if (filterPlan   !== "all")  params.plan           = filterPlan;
      if (filterCycle  !== "all")  params.billing_cycle  = filterCycle;
      if (filterTenant !== "all")  params.tenant_id      = filterTenant;

      const data = await fetchSubscriptions(params);
      setRows(data ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't load subscriptions");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([loadTenants(), load()]);
    const timer = setInterval(() => void load(true), 30_000);
    return () => clearInterval(timer);
  }, []);

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!cTenant) return toast.error("Select a tenant");
    setCreating(true);
    try {
      await createSubscription({
        tenant_id:       cTenant,
        plan:            cPlan,
        billing_cycle:   cCycle,
        discount_percent: Number(cDiscount) || 0,
        notes:           cNotes.trim() || null,
        period_start:    cPeriodStart || null,
      });
      toast.success("Subscription created");
      setCreateOpen(false);
      setCTenant(""); setCPlan("Basic"); setCCycle("per_term");
      setCDiscount("0"); setCNotes(""); setCPeriodStart("");
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create subscription");
    } finally {
      setCreating(false);
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  function openEdit(row: SubscriptionRow) {
    setEditRow(row);
    setEPlan(row.plan);
    setECycle(row.billing_cycle);
    setEStatus(row.status);
    setEDiscount(String(row.discount_percent ?? 0));
    setENotes(row.notes ?? "");
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    if (!editRow) return;
    setSaving(true);
    try {
      await updateSubscription(editRow.id, {
        plan:             ePlan,
        billing_cycle:    eCycle,
        status:           eStatus,
        discount_percent: Number(eDiscount) || 0,
        notes:            eNotes.trim() || null,
      });
      toast.success("Subscription updated");
      setEditOpen(false);
      setEditRow(null);
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update subscription");
    } finally {
      setSaving(false);
    }
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async function handleCancel(id: string) {
    try {
      await cancelSubscription(id);
      toast.success("Subscription cancelled");
      setCancelTarget(null);
      await load(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to cancel subscription");
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) =>
      !term ||
      (r.tenant_name ?? "").toLowerCase().includes(term) ||
      (r.tenant_slug ?? "").toLowerCase().includes(term) ||
      r.plan.toLowerCase().includes(term)
    );
  }, [rows, q]);

  const activeCount   = rows.filter((r) => r.status === "active").length;
  const pastDueCount  = rows.filter((r) => r.status === "past_due").length;
  const trialCount    = rows.filter((r) => r.status === "trialing").length;
  const termCount     = rows.filter((r) => r.billing_cycle === "per_term").length;
  const yearCount     = rows.filter((r) => r.billing_cycle === "full_year").length;
  const totalMrr      = rows
    .filter((r) => r.status === "active")
    .reduce((sum, r) => {
      const monthly = r.billing_cycle === "per_term"
        ? r.amount_kes / 4          // ~4 months per term
        : r.amount_kes / 12;
      return sum + monthly;
    }, 0);

  // Preview amount for create dialog
  const previewAmount = computeAmount(cPlan, cCycle, Number(cDiscount) || 0);

  // Preview amount for edit dialog
  const editPreviewAmount = editRow
    ? computeAmount(ePlan, eCycle, Number(eDiscount) || 0)
    : 0;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Super Admin" nav={nav} activeHref="/saas/subscriptions">

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Subscription</DialogTitle>
            <DialogDescription>
              Assign a billing plan and payment cycle to a tenant institution.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">

            {/* Tenant */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Tenant <span className="text-red-500">*</span>
              </Label>
              <Select value={cTenant} onValueChange={setCTenant}>
                <SelectTrigger>
                  <SelectValue placeholder="Select institution…" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <span>{t.name}</span>
                        <span className="text-xs text-slate-400">({t.slug})</span>
                        {!t.is_active && <span className="text-xs text-red-400">inactive</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Plan */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Plan</Label>
              <Select value={cPlan} onValueChange={setCPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Billing cycle — two-card selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Billing Cycle</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["per_term", "full_year"] as BillingCycle[]).map((cycle) => {
                  const Icon = billingIcon(cycle);
                  const isSelected = cCycle === cycle;
                  return (
                    <button
                      key={cycle}
                      type="button"
                      onClick={() => setCCycle(cycle)}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? "border-blue-200 bg-blue-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon className={`h-4 w-4 ${isSelected ? "text-blue-600" : "text-slate-400"}`} />
                        <span className={`text-sm font-semibold ${isSelected ? "text-blue-800" : "text-slate-700"}`}>
                          {billingLabel(cycle)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {cycle === "per_term"
                          ? "3 payments/year · billed each school term"
                          : "1 payment/year · billed upfront annually"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Discount */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Discount %</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="0"
                  value={cDiscount}
                  onChange={(e) => setCDiscount(e.target.value)}
                  className="w-24"
                />
                <span className="text-xs text-slate-400">
                  % off — typically 10–20% for full-year
                </span>
              </div>
            </div>

            {/* Amount preview */}
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-blue-600">Amount to Bill</div>
                  <div className="text-xs text-blue-400">
                    {cCycle === "per_term" ? "per school term" : "per year (upfront)"}
                  </div>
                </div>
                <div className="text-2xl font-bold text-blue-900">
                  {formatKes(previewAmount)}
                </div>
              </div>
              {Number(cDiscount) > 0 && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-blue-500">
                  <BadgePercent className="h-3 w-3" />
                  {cDiscount}% discount applied — base was{" "}
                  {formatKes(computeAmount(cPlan, cCycle, 0))}
                </div>
              )}
            </div>

            {/* Period start */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Period Start <span className="text-slate-400 font-normal">(optional)</span>
              </Label>
              <Input
                type="date"
                value={cPeriodStart}
                onChange={(e) => setCPeriodStart(e.target.value)}
              />
              <p className="text-xs text-slate-400">Defaults to today if not specified.</p>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Notes</Label>
              <Input
                placeholder="e.g. Negotiated rate, trial extension…"
                value={cNotes}
                onChange={(e) => setCNotes(e.target.value)}
              />
            </div>

            <Separator />
            <p className="text-xs text-slate-400">
              Calls <code className="rounded bg-slate-100 px-1">POST /api/v1/admin/subscriptions</code>.
              Implement billing logic in your Python backend.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={creating || !cTenant}
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
              ) : "Create Subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Subscription</DialogTitle>
            <DialogDescription>
              {editRow?.tenant_name ?? "—"} ·{" "}
              <code className="rounded bg-slate-100 px-1 text-xs">{editRow?.tenant_slug}</code>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">

            {/* Plan */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Plan</Label>
              <Select value={ePlan} onValueChange={setEPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Billing cycle */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Billing Cycle</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["per_term", "full_year"] as BillingCycle[]).map((cycle) => {
                  const Icon = billingIcon(cycle);
                  const isSelected = eCycle === cycle;
                  return (
                    <button
                      key={cycle}
                      type="button"
                      onClick={() => setECycle(cycle)}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? "border-blue-200 bg-blue-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon className={`h-4 w-4 ${isSelected ? "text-blue-600" : "text-slate-400"}`} />
                        <span className={`text-sm font-semibold ${isSelected ? "text-blue-800" : "text-slate-700"}`}>
                          {billingLabel(cycle)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {cycle === "per_term"
                          ? "3 payments/year"
                          : "1 payment/year"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Status</Label>
              <Select value={eStatus} onValueChange={(v: any) => setEStatus(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusDot(s)}`} />
                        {s.replace("_", " ")}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Discount */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Discount %</Label>
              <Input
                type="number"
                min="0" max="100" step="1"
                value={eDiscount}
                onChange={(e) => setEDiscount(e.target.value)}
                className="w-24"
              />
            </div>

            {/* Amount preview */}
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-blue-600">New Billing Amount</div>
                  <div className="text-xs text-blue-400">
                    {eCycle === "per_term" ? "per school term" : "per year (upfront)"}
                  </div>
                </div>
                <div className="text-2xl font-bold text-blue-900">
                  {formatKes(editPreviewAmount)}
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Notes</Label>
              <Input
                placeholder="Admin notes…"
                value={eNotes}
                onChange={(e) => setENotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button
              onClick={() => void handleSaveEdit()}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel confirm ── */}
      <AlertDialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel subscription for "{cancelTarget?.tenant_name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the subscription as cancelled. The tenant will lose access at the end
              of their current period. This action can be reversed by creating a new subscription.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => cancelTarget && void handleCancel(cancelTarget.id)}
            >
              Cancel Subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Page body ── */}
      <div className="space-y-5">

        {/* Header */}
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-700 via-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                  <CreditCard className="h-3 w-3" />
                  Super Admin · Billing
                </span>
              </div>
              <h1 className="text-xl font-bold">Subscription Management</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Manage per-term and full-year billing plans across all tenant institutions
              </p>
            </div>
            <div className="flex items-center gap-3">
              {[
                { label: "Total",    value: rows.length  },
                { label: "Active",   value: activeCount  },
                { label: "Past Due", value: pastDueCount, warn: pastDueCount > 0 },
                { label: "Trialing", value: trialCount   },
              ].map((item) => (
                <div key={item.label} className={`rounded-xl px-3 py-2 text-center backdrop-blur ${(item as any).warn ? "bg-red-500/20" : "bg-white/10"}`}>
                  <div className={`text-xl font-bold ${(item as any).warn ? "text-red-200" : "text-white"}`}>{item.value}</div>
                  <div className="text-xs text-blue-200">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Past due alert */}
        {pastDueCount > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
            <strong>{pastDueCount}</strong> subscription{pastDueCount !== 1 ? "s are" : " is"} past due.
            Use the filter below to review them.
          </div>
        )}

        {/* Error */}
        {err && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2"><XCircle className="h-4 w-4 shrink-0 text-red-500" />{err}</div>
            <button onClick={() => setErr(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Active Subs",    value: activeCount,         color: "border-emerald-100 bg-emerald-50 text-emerald-900 text-emerald-400" },
            { label: "Per Term",       value: termCount,           color: "border-blue-100 bg-blue-50 text-blue-900 text-blue-400" },
            { label: "Full Year",      value: yearCount,           color: "border-purple-100 bg-purple-50 text-purple-900 text-purple-400" },
            { label: "Past Due",       value: pastDueCount,        color: pastDueCount > 0 ? "border-red-100 bg-red-50 text-red-900 text-red-400" : "border-slate-100 bg-slate-50 text-slate-900 text-slate-400" },
            { label: "Est. MRR",       value: formatKes(totalMrr), color: "border-amber-100 bg-amber-50 text-amber-900 text-amber-400" },
          ].map((item) => {
            const [border, bg, textVal, textSub] = item.color.split(" ");
            return (
              <div key={item.label} className={`rounded-xl border px-4 py-3 ${border} ${bg}`}>
                <div className={`text-xl font-bold ${textVal}`}>{item.value}</div>
                <div className={`text-xs font-medium ${textSub}`}>{item.label}</div>
              </div>
            );
          })}
        </div>

        {/* Billing cycle breakdown */}
        <div className="grid gap-4 sm:grid-cols-2">
          {(["per_term", "full_year"] as BillingCycle[]).map((cycle) => {
            const subs    = rows.filter((r) => r.billing_cycle === cycle && r.status === "active");
            const revenue = subs.reduce((s, r) => s + r.amount_kes, 0);
            const Icon    = billingIcon(cycle);
            return (
              <div key={cycle} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{billingLabel(cycle)}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {cycle === "per_term"
                      ? "Invoiced each school term (3× per year)"
                      : "Single upfront annual payment"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-slate-800">{subs.length}</div>
                  <div className="text-xs text-slate-400">tenants</div>
                  <div className="mt-0.5 text-xs font-medium text-emerald-600">{formatKes(revenue)}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Table card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">

          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Subscriptions</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {filteredRows.length} of {rows.length} subscription{rows.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search tenant, plan…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="h-8 w-44 pl-8 text-xs"
                />
              </div>

              {/* Status filter */}
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* Cycle filter */}
              <Select value={filterCycle} onValueChange={setFilterCycle}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Cycle" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cycles</SelectItem>
                  <SelectItem value="per_term">Per Term</SelectItem>
                  <SelectItem value="full_year">Full Year</SelectItem>
                </SelectContent>
              </Select>

              {/* Plan filter */}
              <Select value={filterPlan} onValueChange={setFilterPlan}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Plan" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All plans</SelectItem>
                  {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void load(true)} disabled={loading}>
                <RefreshCw className="h-3 w-3" />
                Refresh
              </Button>

              <Button size="sm" className="h-8 gap-1.5 bg-blue-600 text-xs hover:bg-blue-700" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                New Subscription
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="w-10 text-xs" />
                  <TableHead className="text-xs">Institution</TableHead>
                  <TableHead className="text-xs">Plan</TableHead>
                  <TableHead className="text-xs">Cycle</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Period End</TableHead>
                  <TableHead className="w-24 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8} className="px-5 py-3">
                      <Skeleton className="h-10 w-full rounded-xl" />
                    </TableCell>
                  </TableRow>
                ))}

                {!loading && filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <CreditCard className="h-7 w-7 text-slate-200" />
                        <p className="text-sm text-slate-400">
                          {q.trim() ? `No subscriptions matching "${q}"` : "No subscriptions yet."}
                        </p>
                        {!q.trim() && (
                          <button onClick={() => setCreateOpen(true)} className="text-xs text-blue-500 hover:underline">
                            Create first subscription →
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && filteredRows.map((r) => {
                  const days = daysUntil(r.period_end);
                  const isDueSoon = days !== null && days >= 0 && days <= 14;
                  const isOverdue = days !== null && days < 0;

                  return (
                    <TableRow key={r.id} className={`hover:bg-slate-50 ${r.status === "past_due" ? "bg-red-50/30" : ""}`}>

                      {/* Avatar */}
                      <TableCell className="py-3 pl-5">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${avatarColor(r.tenant_id)}`}>
                          {(r.tenant_name ?? "T")[0]?.toUpperCase()}
                        </div>
                      </TableCell>

                      {/* Tenant */}
                      <TableCell className="py-3">
                        <div className="text-sm font-semibold text-slate-900">{r.tenant_name ?? "—"}</div>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <code className="cursor-default text-xs text-slate-400 hover:text-slate-600">
                                {r.tenant_slug ?? r.tenant_id.slice(0, 8) + "…"}
                              </code>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <span className="font-mono text-xs">ID: {r.tenant_id}</span>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>

                      {/* Plan */}
                      <TableCell className="py-3">
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
                          {r.plan}
                        </span>
                      </TableCell>

                      {/* Billing cycle */}
                      <TableCell className="py-3">
                        {(() => {
                          const Icon = billingIcon(r.billing_cycle);
                          return (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                              <Icon className="h-3.5 w-3.5 text-slate-400" />
                              {billingLabel(r.billing_cycle)}
                            </span>
                          );
                        })()}
                      </TableCell>

                      {/* Amount */}
                      <TableCell className="py-3">
                        <div className="text-sm font-semibold text-slate-800">{formatKes(r.amount_kes)}</div>
                        {r.discount_percent ? (
                          <div className="flex items-center gap-1 text-xs text-emerald-600">
                            <BadgePercent className="h-3 w-3" />
                            {r.discount_percent}% off
                          </div>
                        ) : null}
                      </TableCell>

                      {/* Status */}
                      <TableCell className="py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle(r.status)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDot(r.status)}`} />
                          {r.status.replace("_", " ")}
                        </span>
                      </TableCell>

                      {/* Period end */}
                      <TableCell className="py-3">
                        <div className={`text-xs ${isOverdue ? "text-red-600 font-medium" : isDueSoon ? "text-amber-600 font-medium" : "text-slate-400"}`}>
                          {formatDate(r.period_end)}
                        </div>
                        {days !== null && (
                          <div className="text-xs text-slate-300">
                            {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d remaining`}
                          </div>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-3 pr-4">
                        <div className="flex items-center gap-1">
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button onClick={() => openEdit(r)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-700">
                                  <Pencil className="h-4 w-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">Edit subscription</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => setCancelTarget(r)}
                                  disabled={r.status === "cancelled"}
                                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">
                                {r.status === "cancelled" ? "Already cancelled" : "Cancel subscription"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {filteredRows.length > 0 && (
            <div className="flex items-center gap-4 border-t border-slate-100 px-6 py-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                {activeCount} active
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <CalendarDays className="h-3.5 w-3.5 text-blue-400" />
                {termCount} per-term
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Calendar className="h-3.5 w-3.5 text-purple-400" />
                {yearCount} full-year
              </span>
              <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <TrendingUp className="h-3.5 w-3.5" />
                Est. MRR: {formatKes(totalMrr)}
              </span>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}