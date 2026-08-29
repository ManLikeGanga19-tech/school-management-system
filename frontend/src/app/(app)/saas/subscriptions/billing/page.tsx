"use client";

import { useEffect, useMemo, useState } from "react";
import { usePersistedState } from "@/lib/usePersistedState";
import { apiFetch } from "@/lib/api";
import { DashboardStatCard } from "@/components/admin/admin-primitives";
import { BillingEligibilityPreview } from "@/components/saas/BillingEligibilityPreview";
import { SaasPageHeader, SaasSurface } from "@/components/saas/page-chrome";
import {
  fetchSubscriptionBillingEligibility,
  type SubscriptionBillingEligibility,
} from "@/lib/admin/subscription-eligibility";
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
  billing_term_label?: string | null;
  billing_term_code?: string | null;
  billing_academic_year?: number | null;
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

const DEFAULT_AMOUNT: Record<BillingPlan, number> = {
  per_term: 8_000,
  per_year: 20_000,
};

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
    trialing:  "bg-[var(--admin-gold-soft)] text-[#8a6d00] ring-1 ring-[var(--admin-border)]",
    past_due:  "bg-red-50 text-red-700 ring-1 ring-red-200",
    cancelled: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    paused:    "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  }[s];
}

function statusDot(s: SubStatus) {
  return {
    active:    "bg-emerald-500",
    trialing:  "bg-[var(--admin-primary)]",
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
    "bg-[var(--admin-gold-soft)] text-[#8a6d00]", "bg-emerald-100 text-emerald-700",
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
  const [planTiers, setPlanTiers] = useState<{ name: string; count: number; price: number }[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);

  // Filters
  const [filterStatus,  setFilterStatus]  = useState<string>("all");
  const [filterBillingPlan, setFilterBillingPlan] = usePersistedState<string>("saas.billing.plan", "all");
  const [filterTenant,  setFilterTenant]  = useState<string>("all");
  const [q, setQ]                         = useState("");

  // Create dialog
  const [createOpen, setCreateOpen]     = useState(false);
  const [cTenant, setCTenant]           = useState("");
  const [cBillingPlan, setCBillingPlan] = useState<BillingPlan>("per_term");
  const [cAmount, setCAmount]           = useState(String(DEFAULT_AMOUNT.per_term));
  const [cDiscount, setCDiscount]       = useState("0");
  const [cNotes, setCNotes]             = useState("");
  const [cPeriodStart, setCPeriodStart] = useState("");
  const [creating, setCreating]         = useState(false);
  const [createEligibility, setCreateEligibility] = useState<SubscriptionBillingEligibility | null>(null);
  const [createEligibilityLoading, setCreateEligibilityLoading] = useState(false);
  const [createEligibilityError, setCreateEligibilityError] = useState<string | null>(null);

  // Edit dialog
  const [editOpen, setEditOpen]   = useState(false);
  const [editRow, setEditRow]     = useState<SubscriptionRow | null>(null);
  const [eBillingPlan, setEBillingPlan] = useState<BillingPlan>("per_term");
  const [eAmount, setEAmount]     = useState("");
  const [eStatus, setEStatus]     = useState<SubStatus>("active");
  const [eDiscount, setEDiscount] = useState("0");
  const [eNotes, setENotes]       = useState("");
  const [saving, setSaving]       = useState(false);
  const [editEligibility, setEditEligibility] = useState<SubscriptionBillingEligibility | null>(null);
  const [editEligibilityLoading, setEditEligibilityLoading] = useState(false);
  const [editEligibilityError, setEditEligibilityError] = useState<string | null>(null);

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

  // Plan-tier distribution for the side card (from the SaaS metrics snapshot).
  useEffect(() => {
    let off = false;
    apiFetch<{ subscriptions?: { plans?: { name: string; count: number; price: number }[] } }>(
      "/admin/saas/metrics",
      { method: "GET", tenantRequired: false }
    )
      .then((m) => { if (!off) setPlanTiers(m?.subscriptions?.plans ?? []); })
      .catch(() => {});
    return () => { off = true; };
  }, []);

  // Auto-suggest standard amount when billing plan changes in Create dialog
  useEffect(() => {
    const isDefault = cAmount === "" || Object.values(DEFAULT_AMOUNT).includes(Number(cAmount));
    if (isDefault) setCAmount(String(DEFAULT_AMOUNT[cBillingPlan]));
  }, [cBillingPlan]);

  useEffect(() => {
    let cancelled = false;

    async function loadCreateEligibility() {
      if (!createOpen) {
        setCreateEligibility(null);
        setCreateEligibilityError(null);
        setCreateEligibilityLoading(false);
        return;
      }
      setCreateEligibilityLoading(true);
      setCreateEligibilityError(null);
      try {
        const eligibility = await fetchSubscriptionBillingEligibility(
          cBillingPlan,
          cPeriodStart || undefined
        );
        if (!cancelled) setCreateEligibility(eligibility);
      } catch (error: any) {
        if (!cancelled) {
          setCreateEligibility(null);
          setCreateEligibilityError(error?.message ?? "Unable to resolve the current billing window.");
        }
      } finally {
        if (!cancelled) setCreateEligibilityLoading(false);
      }
    }

    void loadCreateEligibility();
    return () => {
      cancelled = true;
    };
  }, [cBillingPlan, cPeriodStart, createOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadEditEligibility() {
      if (!editOpen || !editRow) {
        setEditEligibility(null);
        setEditEligibilityError(null);
        setEditEligibilityLoading(false);
        return;
      }
      setEditEligibilityLoading(true);
      setEditEligibilityError(null);
      try {
        const eligibility = await fetchSubscriptionBillingEligibility(
          eBillingPlan,
          editRow.period_start || undefined
        );
        if (!cancelled) setEditEligibility(eligibility);
      } catch (error: any) {
        if (!cancelled) {
          setEditEligibility(null);
          setEditEligibilityError(error?.message ?? "Unable to resolve the current billing window.");
        }
      } finally {
        if (!cancelled) setEditEligibilityLoading(false);
      }
    }

    void loadEditEligibility();
    return () => {
      cancelled = true;
    };
  }, [eBillingPlan, editOpen, editRow]);

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
      setCTenant(""); setCBillingPlan("per_term"); setCAmount(String(DEFAULT_AMOUNT.per_term));
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
    <>

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-lg overflow-y-auto">
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

            <BillingEligibilityPreview
              eligibility={createEligibility}
              loading={createEligibilityLoading}
              error={createEligibilityError}
              title="Current billing window"
            />

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
              className="bg-[var(--admin-primary)] hover:bg-[var(--admin-slate)]"
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
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-lg overflow-y-auto">
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

            <BillingEligibilityPreview
              eligibility={editEligibility}
              loading={editEligibilityLoading}
              error={editEligibilityError}
              title="Current billing window"
            />

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

            <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-gold-soft)] px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-[#8a6d00]">Billing Plan</div>
                  <div className="text-xs text-[var(--admin-slate)]">
                    {billingLabel(eBillingPlan)}
                  </div>
                </div>
                <div className="text-2xl font-bold text-[#8a6d00]">
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
              className="bg-[var(--admin-primary)] hover:bg-[var(--admin-slate)]"
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

        {/* At-Risk + Plan Distribution (insight side cards, per Stitch) */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* At-Risk Subscriptions */}
          <SaasSurface className="border-[var(--admin-gold)]/60 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--admin-gold)]" />
              <h3 className="font-serif text-base font-bold text-[var(--admin-ink)]">At-Risk Subscriptions</h3>
            </div>
            {(() => {
              const now = Date.now();
              const risk = rows.filter(
                (r) =>
                  r.status === "past_due" ||
                  (r.status === "trialing" && r.period_end && new Date(r.period_end).getTime() - now < 14 * 864e5)
              );
              if (risk.length === 0)
                return <p className="text-sm text-[var(--admin-muted)]">No at-risk subscriptions — all accounts healthy.</p>;
              return (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--admin-muted)]">
                    Immediate attention required for {risk.length} account{risk.length !== 1 ? "s" : ""}.
                  </p>
                  {risk.slice(0, 4).map((r) => {
                    const overdue = r.status === "past_due";
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${overdue ? "border-red-200 bg-red-50" : "border-[var(--admin-border)] bg-[var(--admin-gold-soft)]"}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--admin-ink)]">{r.tenant_name || r.tenant_slug}</div>
                          <div className={`text-xs ${overdue ? "text-red-600" : "text-[#8a6d00]"}`}>
                            {overdue ? "Payment past due" : "Trial ending soon"}
                            {r.period_end ? ` · ${new Date(r.period_end).toLocaleDateString("en-KE")}` : ""}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => openEdit(r)}>Review</Button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </SaasSurface>

          {/* Plan Distribution (by subscription tier) */}
          <SaasSurface className="p-5">
            <h3 className="font-serif text-base font-bold text-[var(--admin-ink)]">Plan Distribution</h3>
            <p className="text-xs text-[var(--admin-muted)]">Tenant count by subscription tier</p>
            {planTiers.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--admin-muted)]">No tier data yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {(() => {
                  const total = planTiers.reduce((s, p) => s + p.count, 0) || 1;
                  const colors = ["#2a78d6", "#d97706", "#7c3aed", "#0891b2", "#be185d"];
                  return planTiers.map((p, i) => {
                    const pct = Math.round((p.count / total) * 100);
                    return (
                      <div key={p.name}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors[i % colors.length] }} />
                            <span className="font-medium text-[var(--admin-ink)]">{p.name}</span>
                          </div>
                          <span className="text-[var(--admin-muted)]">{p.count} ({pct}%)</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }} />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </SaasSurface>
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

              <Button size="sm" className="h-8 gap-1.5 bg-[var(--admin-primary)] text-xs hover:bg-[var(--admin-slate)]" onClick={() => setCreateOpen(true)}>
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
                          <button onClick={() => setCreateOpen(true)} className="text-xs text-[var(--admin-slate)] hover:underline">
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
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--admin-gold-soft)] px-2 py-0.5 text-xs font-medium text-[#8a6d00] ring-1 ring-[var(--admin-border)]">
                                <Icon className="h-3.5 w-3.5 text-[var(--admin-slate)]" />
                                {billingLabel(plan)}
                              </span>
                              {r.billing_term_label ? (
                                <div className="text-xs text-slate-500">
                                  Starts in <span className="font-medium text-slate-700">{r.billing_term_label}</span>
                                </div>
                              ) : null}
                            </div>
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
                <CalendarDays className="h-3.5 w-3.5 text-[var(--admin-slate)]" />
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
    </>
  );
}
