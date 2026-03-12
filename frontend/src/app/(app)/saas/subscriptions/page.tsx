"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { saasNav } from "@/components/layout/nav-config";
import { DashboardStatCard } from "@/components/dashboard/dashboard-primitives";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
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
  Pencil,
  Trash2,
  BadgePercent,
  TrendingUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type BillingPlan = "per_term" | "per_year";
type SubStatus    = "active" | "trialing" | "past_due" | "cancelled" | "paused";

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  tenant_slug?: string;
  billing_plan?: BillingPlan | null;
  /** Backward-compatible mirrors from older API payloads */
  plan?: string | null;
  billing_cycle?: "per_term" | "full_year" | null;
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

const BILLING_PLANS: BillingPlan[] = ["per_term", "per_year"];
const STATUSES: SubStatus[] = ["active", "trialing", "past_due", "cancelled", "paused"];

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

function resolveBillingPlan(row: SubscriptionRow): BillingPlan {
  const direct = String(row.billing_plan ?? "").trim().toLowerCase();
  if (direct === "per_term" || direct === "per_year") return direct;
  const legacyCycle = String(row.billing_cycle ?? "").trim().toLowerCase();
  if (legacyCycle === "full_year") return "per_year";
  if (legacyCycle === "per_term") return "per_term";
  return "per_term";
}

function billingLabel(plan: BillingPlan) {
  return plan === "per_term" ? "Per Term" : "Per Year";
}

function billingIcon(plan: BillingPlan) {
  return plan === "per_term" ? CalendarDays : Calendar;
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
 * Query params: status?, tenant_id?, billing_plan?
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
 * Body: { tenant_id, billing_plan, amount_kes, discount_percent?, notes?, period_start? }
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
 * Body: { billing_plan?, amount_kes?, status?, discount_percent?, notes? }
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
  const [filterBillingPlan, setFilterBillingPlan] = useState<string>("all");
  const [filterTenant,  setFilterTenant]  = useState<string>("all");
  const [q, setQ]                         = useState("");

  // Create dialog
  const [createOpen, setCreateOpen]     = useState(false);
  const [cTenant, setCTenant]           = useState("");
  const [cBillingPlan, setCBillingPlan] = useState<BillingPlan>("per_term");
  const [cAmount, setCAmount]           = useState("");
  const [cDiscount, setCDiscount]       = useState("0");
  const [cNotes, setCNotes]             = useState("");
  const [cPeriodStart, setCPeriodStart] = useState("");
  const [creating, setCreating]         = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen]   = useState(false);
  const [editRow, setEditRow]     = useState<SubscriptionRow | null>(null);
  const [eBillingPlan, setEBillingPlan] = useState<BillingPlan>("per_term");
  const [eAmount, setEAmount]     = useState("");
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
      if (filterBillingPlan !== "all") params.billing_plan = filterBillingPlan;
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
    if (!cAmount || Number(cAmount) <= 0) return toast.error("Enter a valid amount");
    setCreating(true);
    try {
      await createSubscription({
        tenant_id:        cTenant,
        billing_plan:     cBillingPlan,
        amount_kes:       Number(cAmount),
        discount_percent: Number(cDiscount) || 0,
        notes:            cNotes.trim() || null,
        period_start:     cPeriodStart || null,
      });
      toast.success("Subscription created");
      setCreateOpen(false);
      setCTenant(""); setCBillingPlan("per_term"); setCAmount("");
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
    setEBillingPlan(resolveBillingPlan(row));
    setEAmount(String(row.amount_kes ?? ""));
    setEStatus(row.status);
    setEDiscount(String(row.discount_percent ?? 0));
    setENotes(row.notes ?? "");
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    if (!editRow) return;
    if (!eAmount || Number(eAmount) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSaving(true);
    try {
      await updateSubscription(editRow.id, {
        billing_plan:     eBillingPlan,
        amount_kes:       Number(eAmount),
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
      billingLabel(resolveBillingPlan(r)).toLowerCase().includes(term)
    );
  }, [rows, q]);

  const activeCount   = rows.filter((r) => r.status === "active").length;
  const pastDueCount  = rows.filter((r) => r.status === "past_due").length;
  const trialCount    = rows.filter((r) => r.status === "trialing").length;
  const termCount     = rows.filter((r) => resolveBillingPlan(r) === "per_term").length;
  const yearCount     = rows.filter((r) => resolveBillingPlan(r) === "per_year").length;
  const totalMrr      = rows
    .filter((r) => r.status === "active")
    .reduce((sum, r) => {
      const monthly = resolveBillingPlan(r) === "per_term"
        ? r.amount_kes / 4          // ~4 months per term
        : r.amount_kes / 12;
      return sum + monthly;
    }, 0);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Super Admin" nav={saasNav} activeHref="/saas/subscriptions">

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Subscription</DialogTitle>
            <DialogDescription>
              Assign a billing plan and manual price to a tenant institution.
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

            {/* Billing plan */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Billing Plan</Label>
              <Select value={cBillingPlan} onValueChange={(value: BillingPlan) => setCBillingPlan(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_PLANS.map((plan) => (
                    <SelectItem key={plan} value={plan}>{billingLabel(plan)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Amount (KES) <span className="text-red-500">*</span>
              </Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                placeholder="e.g. 15000"
                value={cAmount}
                onChange={(e) => setCAmount(e.target.value)}
              />
              <p className="text-xs text-slate-400">
                Price is manually controlled by SaaS admin. No hardcoded pricing is applied.
              </p>
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
                  Optional metadata for negotiated discounts.
                </span>
              </div>
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
              Billing plan is <code className="rounded bg-slate-100 px-1">per_term</code> or <code className="rounded bg-slate-100 px-1">per_year</code>.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={creating || !cTenant || Number(cAmount) <= 0}
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

            {/* Billing plan */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Billing Plan</Label>
              <Select value={eBillingPlan} onValueChange={(value: BillingPlan) => setEBillingPlan(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_PLANS.map((plan) => (
                    <SelectItem key={plan} value={plan}>{billingLabel(plan)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">
                Amount (KES) <span className="text-red-500">*</span>
              </Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                value={eAmount}
                onChange={(e) => setEAmount(e.target.value)}
              />
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

            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-blue-600">Billing Plan</div>
                  <div className="text-xs text-blue-400">
                    {billingLabel(eBillingPlan)}
                  </div>
                </div>
                <div className="text-2xl font-bold text-blue-900">
                  {formatKes(Number(eAmount) || 0)}
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
        <SaasPageHeader
          title="Subscription Management"
          description="Control subscription plans, negotiated pricing, renewal cadence, and portfolio billing health across every tenant."
          badges={[
            { label: "Super Admin", icon: CreditCard },
            { label: "Billing Control", icon: TrendingUp },
          ]}
          metrics={[
            { label: "Total", value: rows.length },
            { label: "Active", value: activeCount },
            { label: "Past Due", value: pastDueCount, tone: pastDueCount > 0 ? "warning" : "default" },
            { label: "Trialing", value: trialCount },
          ]}
        />

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
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <DashboardStatCard label="Active Subs" value={activeCount} sub="Tenants with live billing coverage" icon={CheckCircle} tone="sage" />
          <DashboardStatCard label="Per Term" value={termCount} sub="Term-billed institutions" icon={CalendarDays} tone="secondary" />
          <DashboardStatCard label="Per Year" value={yearCount} sub="Annual-billed institutions" icon={Calendar} tone="accent" />
          <DashboardStatCard label="Past Due" value={pastDueCount} sub="Subscriptions needing intervention" icon={AlertTriangle} tone={pastDueCount > 0 ? "danger" : "neutral"} />
          <DashboardStatCard label="Est. MRR" value={formatKes(totalMrr)} sub="Approximate monthly normalized revenue" icon={BadgePercent} tone="warning" />
        </div>

        {/* Billing plan breakdown */}
        <div className="grid gap-4 sm:grid-cols-2">
          {BILLING_PLANS.map((plan) => {
            const subs = rows.filter((r) => resolveBillingPlan(r) === plan && r.status === "active");
            const revenue = subs.reduce((s, r) => s + r.amount_kes, 0);
            const Icon = billingIcon(plan);
            return (
              <SaasSurface key={plan} className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{billingLabel(plan)}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {plan === "per_term"
                      ? "Invoiced each school term (3× per year)"
                      : "Single upfront annual payment"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-slate-800">{subs.length}</div>
                  <div className="text-xs text-slate-400">tenants</div>
                  <div className="mt-0.5 text-xs font-medium text-emerald-600">{formatKes(revenue)}</div>
                </div>
              </SaasSurface>
            );
          })}
        </div>

        {/* Table card */}
        <SaasSurface className="overflow-hidden">

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

            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {/* Search */}
              <div className="relative w-full sm:w-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search tenant, billing plan…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="h-8 w-full pl-8 text-xs sm:w-44"
                />
              </div>

              {/* Status filter */}
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 w-full text-xs sm:w-32"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* Billing plan filter */}
              <Select value={filterBillingPlan} onValueChange={setFilterBillingPlan}>
                <SelectTrigger className="h-8 w-full text-xs sm:w-36"><SelectValue placeholder="Billing plan" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All billing plans</SelectItem>
                  <SelectItem value="per_term">Per Term</SelectItem>
                  <SelectItem value="per_year">Per Year</SelectItem>
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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="w-10 text-xs" />
                  <TableHead className="text-xs">Institution</TableHead>
                  <TableHead className="text-xs">Billing Plan</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Period End</TableHead>
                  <TableHead className="w-24 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7} className="px-5 py-3">
                      <Skeleton className="h-10 w-full rounded-xl" />
                    </TableCell>
                  </TableRow>
                ))}

                {!loading && filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center">
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

                      {/* Billing plan */}
                      <TableCell className="py-3">
                        {(() => {
                          const plan = resolveBillingPlan(r);
                          const Icon = billingIcon(plan);
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
                              <Icon className="h-3.5 w-3.5 text-blue-500" />
                              {billingLabel(plan)}
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
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-3">
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
                {yearCount} per-year
              </span>
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 sm:ml-auto">
                <TrendingUp className="h-3.5 w-3.5" />
                Est. MRR: {formatKes(totalMrr)}
              </span>
            </div>
          )}
        </SaasSurface>
      </div>
    </AppShell>
  );
}
