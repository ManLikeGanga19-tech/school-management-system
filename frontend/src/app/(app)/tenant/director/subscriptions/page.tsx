"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  CreditCard,
  CalendarDays,
  Calendar,
  CheckCircle,
  AlertTriangle,
  Clock,
  BadgePercent,
  Smartphone,
  ShieldCheck,
  XCircle,
  ChevronRight,
  Loader2,
  RefreshCw,
  Building2,
  Receipt,
  TrendingUp,
  Zap,
  ArrowUpRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type BillingCycle = "per_term" | "full_year";
type SubStatus = "active" | "trialing" | "past_due" | "cancelled" | "paused";

type DirectorSubscription = {
  id: string;
  plan: string;
  billing_cycle: BillingCycle;
  status: SubStatus;
  amount_kes: number;
  discount_percent?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  next_payment_date?: string | null;
  next_payment_amount?: number | null;
  created_at?: string | null;
  notes?: string | null;
  tenant_name?: string;
  tenant_slug?: string;
};

type PaymentHistoryRow = {
  id: string;
  amount_kes: number;
  paid_at: string;
  mpesa_receipt?: string | null;
  phone?: string | null;
  period_label?: string | null;
  status: "completed" | "failed" | "pending";
};

type MpesaInitResponse = {
  checkout_request_id: string;
  merchant_request_id: string;
  response_description: string;
};

type PayStep = "form" | "waiting" | "success" | "failed";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatKes(v: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function statusConfig(s: SubStatus) {
  return {
    active: {
      label: "Active",
      dot: "bg-emerald-500",
      pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    },
    trialing: {
      label: "Trial",
      dot: "bg-blue-500",
      pill: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    },
    past_due: {
      label: "Past Due",
      dot: "bg-red-500",
      pill: "bg-red-50 text-red-700 ring-1 ring-red-200",
    },
    cancelled: {
      label: "Cancelled",
      dot: "bg-slate-400",
      pill: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    },
    paused: {
      label: "Paused",
      dot: "bg-amber-500",
      pill: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    },
  }[s];
}

function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return "254" + digits.slice(1);
  return digits;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
      {children}
    </h2>
  );
}

function MetaCell({
  label,
  value,
  sub,
  subColor = "text-slate-400",
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div className="bg-white px-5 py-4">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${subColor}`}>{sub}</div>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DirectorSubscriptionsPage() {
  const [sub, setSub] = useState<DirectorSubscription | null>(null);
  const [history, setHistory] = useState<PaymentHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [histLoading, setHistLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // M-Pesa dialog
  const [payOpen, setPayOpen] = useState(false);
  const [step, setStep] = useState<PayStep>("form");
  const [phone, setPhone] = useState("");
  const [checkoutId, setCheckoutId] = useState("");
  const [paying, setPaying] = useState(false);
  const [polling, setPolling] = useState(false);

  const SUB_ENDPOINT         = "/finance/subscription";
  const SUB_PAYMENTS_ENDPOINT = "/finance/subscription/payments";
  const SUB_PAY_ENDPOINT     = "/finance/subscription/pay";
  const SUB_STATUS_ENDPOINT  = "/finance/subscription/payment-status";

  async function loadSub(silent = false) {
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const data = await apiFetch<DirectorSubscription>(SUB_ENDPOINT, {
        method: "GET",
        tenantRequired: true,
      });
      setSub(data);
      setLastUpdated(new Date());
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't load subscription details");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadHistory() {
    setHistLoading(true);
    try {
      const data = await apiFetch<PaymentHistoryRow[]>(SUB_PAYMENTS_ENDPOINT, {
        method: "GET",
        tenantRequired: true,
      });
      setHistory(data ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([loadSub(), loadHistory()]);
  }, []);

  function openPay() {
    setStep("form");
    setPhone("");
    setCheckoutId("");
    setPayOpen(true);
  }

  function closePay() {
    setPayOpen(false);
    if (step === "success") {
      void loadSub(true);
      void loadHistory();
    }
  }

  async function handlePay() {
    const normalised = normalisePhone(phone);
    if (normalised.length !== 12) {
      return toast.error("Enter a valid Safaricom number (07XX or 01XX)");
    }
    const amount = sub?.next_payment_amount ?? sub?.amount_kes ?? 0;
    setPaying(true);
    try {
      const res = await apiFetch<MpesaInitResponse>(SUB_PAY_ENDPOINT, {
        method: "POST",
        tenantRequired: true,
        body: JSON.stringify({ phone_number: normalised, amount, subscription_id: sub?.id }),
        headers: { "Content-Type": "application/json" },
      } as any);
      setCheckoutId(res.checkout_request_id);
      setStep("waiting");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to initiate M-Pesa payment");
    } finally {
      setPaying(false);
    }
  }

  useEffect(() => {
    if (step !== "waiting" || !checkoutId) return;
    const interval = setInterval(async () => {
      if (polling) return;
      setPolling(true);
      try {
        const res = await apiFetch<{ status: string }>(
          `${SUB_STATUS_ENDPOINT}?checkout_request_id=${encodeURIComponent(checkoutId)}`,
          { method: "GET", tenantRequired: true }
        );
        if (res.status === "completed") { setStep("success"); clearInterval(interval); }
        if (res.status === "failed")    { setStep("failed");  clearInterval(interval); }
      } catch { /* keep polling */ }
      finally { setPolling(false); }
    }, 5_000);
    return () => clearInterval(interval);
  }, [step, checkoutId, polling]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const days      = daysUntil(sub?.period_end);
  const isOverdue = days !== null && days < 0;
  const isDueSoon = days !== null && days >= 0 && days <= 14;
  const canPay    = sub && ["active", "past_due", "trialing"].includes(sub.status);
  const cfg       = sub ? statusConfig(sub.status) : null;
  const nextAmt   = sub?.next_payment_amount ?? sub?.amount_kes ?? 0;
  const CycleIcon = sub?.billing_cycle === "per_term" ? CalendarDays : Calendar;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/subscriptions">

      {/* ── M-Pesa Payment Dialog ─────────────────────────────────────────── */}
      <Dialog open={payOpen} onOpenChange={closePay}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                <Smartphone className="h-4 w-4 text-emerald-600" />
              </div>
              Pay via M-Pesa
            </DialogTitle>
            <DialogDescription>
              {sub?.plan} Plan ·{" "}
              {sub?.billing_cycle === "per_term" ? "Per Term Payment" : "Annual Payment"}
            </DialogDescription>
          </DialogHeader>

          {step === "form" && (
            <div className="space-y-5 py-1">
              {/* Amount card */}
              <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-emerald-50 to-teal-50 p-5 text-center shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-widest text-emerald-600">
                  Amount Due
                </div>
                <div className="mt-2 text-4xl font-bold tracking-tight text-emerald-900">
                  {formatKes(nextAmt)}
                </div>
                <div className="mt-1 text-xs text-emerald-600">
                  {sub?.billing_cycle === "per_term"
                    ? "for this school term"
                    : "for the full academic year"}
                </div>
              </div>

              {/* Phone input */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">
                  M-Pesa Phone Number
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
                    🇰🇪
                  </span>
                  <Input
                    placeholder="0712 345 678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handlePay()}
                    className="pl-9 tracking-wide"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Accepts 07XX, 01XX, or 254XXXXXXXXX format.
                </p>
              </div>

              <Separator />

              {/* Steps */}
              <div className="space-y-2.5">
                {[
                  "You'll receive an M-Pesa STK push notification",
                  "Enter your M-Pesa PIN to authorise the payment",
                  "Confirmation is automatic — no manual action needed",
                ].map((s, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      {i + 1}
                    </div>
                    <p className="text-xs leading-relaxed text-slate-500">{s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "waiting" && (
            <div className="flex flex-col items-center gap-5 py-8">
              <div className="relative">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50">
                  <Smartphone className="h-9 w-9 text-emerald-600" />
                </div>
                <span className="absolute -right-1 -top-1 flex h-5 w-5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-5 w-5 rounded-full bg-emerald-500" />
                </span>
              </div>
              <div className="text-center">
                <div className="text-base font-semibold text-slate-800">Check your phone</div>
                <p className="mt-1 text-sm text-slate-500">
                  A payment prompt was sent to{" "}
                  <span className="font-semibold text-slate-700">{phone}</span>.
                  <br />Enter your M-Pesa PIN to complete.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Waiting for M-Pesa confirmation…
              </div>
              <button
                onClick={() => setStep("form")}
                className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
              >
                Didn&apos;t receive it? Go back
              </button>
            </div>
          )}

          {step === "success" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle className="h-10 w-10 text-emerald-600" />
              </div>
              <div className="text-center">
                <div className="text-base font-semibold text-slate-800">Payment Received!</div>
                <p className="mt-1 text-sm text-slate-500">
                  {formatKes(nextAmt)} received successfully. Your subscription is up to date.
                </p>
              </div>
              <div className="w-full rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-center text-xs text-emerald-600">
                An M-Pesa confirmation SMS has been sent to your number.
              </div>
            </div>
          )}

          {step === "failed" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
                <XCircle className="h-10 w-10 text-red-500" />
              </div>
              <div className="text-center">
                <div className="text-base font-semibold text-slate-800">Payment Failed</div>
                <p className="mt-1 text-sm text-slate-500">
                  The transaction was not completed. Please check your M-Pesa PIN and balance,
                  then try again.
                </p>
              </div>
              <Button variant="outline" className="gap-2" onClick={() => setStep("form")}>
                Try Again
              </Button>
            </div>
          )}

          <DialogFooter>
            {step === "form" && (
              <>
                <Button variant="outline" onClick={closePay} disabled={paying}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handlePay()}
                  disabled={paying || !phone.trim()}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  {paying ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Sending…</>
                  ) : (
                    <><Smartphone className="h-4 w-4" />Send STK Push</>
                  )}
                </Button>
              </>
            )}
            {(step === "success" || step === "failed") && (
              <Button className="w-full" onClick={closePay}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Page body ─────────────────────────────────────────────────────── */}
      <div className="space-y-5">

        {/* ── Hero header — matches SaaS dashboard gradient style ── */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-600 p-6 text-white shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                  <CreditCard className="h-3 w-3" />
                  Subscription
                </span>
                {sub && cfg && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold">Billing &amp; Subscription</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {sub?.tenant_name
                  ? `${sub.tenant_name} · manage your institution's plan and payments`
                  : "Manage your institution's billing plan and payment history"}
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              {/* Quick stats strip */}
              {!loading && sub && (
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: "Plan",     value: sub.plan },
                    { label: "Amount",   value: formatKes(sub.amount_kes) },
                    { label: "Days Left",value: days !== null ? (isOverdue ? "Overdue" : `${days}d`) : "—" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-white/10 px-4 py-2 backdrop-blur">
                      <div className="text-sm font-bold text-white">{item.value}</div>
                      <div className="text-xs text-blue-200">{item.label}</div>
                    </div>
                  ))}
                </div>
              )}
              {loading && (
                <div className="grid grid-cols-3 gap-3">
                  {[1,2,3].map(i => (
                    <Skeleton key={i} className="h-14 w-24 rounded-xl bg-white/10" />
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3">
                {lastUpdated && (
                  <span className="text-xs text-blue-200">
                    Updated {Math.floor((Date.now() - lastUpdated.getTime()) / 1000)}s ago
                  </span>
                )}
                <button
                  onClick={() => { void loadSub(true); void loadHistory(); }}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white backdrop-blur transition hover:bg-white/20"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Alerts ── */}
        {!loading && err && (
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 shrink-0 text-red-500" />
              <div>
                <div className="font-medium">Couldn&apos;t load subscription</div>
                <div className="text-xs text-red-600">{err}</div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadSub()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && sub?.status === "past_due" && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
            <span className="flex-1">
              Your subscription payment is overdue. Pay now to avoid service interruption.
            </span>
            <Button
              size="sm"
              onClick={openPay}
              className="shrink-0 gap-1.5 bg-red-600 hover:bg-red-700 text-xs"
            >
              <Smartphone className="h-3.5 w-3.5" />
              Pay Now
            </Button>
          </div>
        )}

        {!loading && sub?.status === "active" && isDueSoon && !isOverdue && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Clock className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="flex-1">
              Next payment of <strong>{formatKes(nextAmt)}</strong> due in{" "}
              <strong>{days} day{days !== 1 ? "s" : ""}</strong>. You can pay early below.
            </span>
          </div>
        )}

        {/* ── Skeleton ── */}
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-52 w-full rounded-2xl" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !err && !sub && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
              <CreditCard className="h-6 w-6 text-slate-300" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-600">No active subscription</div>
              <div className="mt-0.5 text-xs text-slate-400">
                Contact your platform administrator to set up billing.
              </div>
            </div>
          </div>
        )}

        {/* ── Main content ── */}
        {!loading && !err && sub && cfg && (
          <>
            {/* ── Plan card ── */}
            <SectionLabel>Current Plan</SectionLabel>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {/* Card header gradient — darker, more premium than the hero */}
              <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                      {sub.billing_cycle === "full_year" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-900/40 px-2 py-0.5 text-xs font-medium text-purple-300">
                          Annual · Best Value
                        </span>
                      )}
                      {(sub.discount_percent ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-300">
                          <BadgePercent className="h-3 w-3" />
                          {sub.discount_percent}% discount
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-2xl font-bold text-white">{sub.plan} Plan</div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
                      <CycleIcon className="h-3.5 w-3.5" />
                      {sub.billing_cycle === "per_term"
                        ? "Billed each school term (3× per year)"
                        : "Billed once annually (full year upfront)"}
                    </div>
                    {sub.tenant_name && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                        <Building2 className="h-3 w-3" />
                        {sub.tenant_name}
                      </div>
                    )}
                  </div>

                  <div className="sm:text-right">
                    <div className="text-3xl font-bold text-white">{formatKes(sub.amount_kes)}</div>
                    <div className="text-xs text-slate-400">
                      {sub.billing_cycle === "per_term" ? "per term" : "per year"}
                    </div>
                    {(sub.discount_percent ?? 0) > 0 && (
                      <div className="mt-1 text-xs text-emerald-400">
                        saving {formatKes(sub.amount_kes * (sub.discount_percent! / 100))} vs. monthly
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Meta row — 4-column grid matching SaaS dashboard pattern */}
              <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
                <MetaCell
                  label="Period Start"
                  value={formatDate(sub.period_start)}
                />
                <MetaCell
                  label="Period End"
                  value={formatDate(sub.period_end)}
                  sub={
                    days === null
                      ? undefined
                      : isOverdue
                      ? `${Math.abs(days)}d overdue`
                      : `${days}d remaining`
                  }
                  subColor={
                    isOverdue
                      ? "text-red-500 font-medium"
                      : isDueSoon
                      ? "text-amber-500 font-medium"
                      : "text-emerald-500"
                  }
                />
                <MetaCell
                  label="Next Payment"
                  value={formatDate(sub.next_payment_date ?? sub.period_end)}
                  sub={formatKes(nextAmt)}
                  subColor="text-blue-600 font-medium"
                />
                <MetaCell
                  label="Subscribed Since"
                  value={formatDate(sub.created_at)}
                />
              </div>

              {/* Notes */}
              {sub.notes && (
                <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">
                  <div className="text-xs font-medium text-slate-400">Note from admin</div>
                  <p className="mt-0.5 text-sm text-slate-600">{sub.notes}</p>
                </div>
              )}

              {/* Footer action */}
              <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  Secured by M-Pesa · Safaricom Daraja
                </div>
                {canPay && (
                  <Button
                    onClick={openPay}
                    className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Smartphone className="h-4 w-4" />
                    Pay via M-Pesa
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* ── Billing cycle cards ── */}
            <SectionLabel>Billing Cycle</SectionLabel>

            <div className="grid gap-4 sm:grid-cols-2">
              {(["per_term", "full_year"] as BillingCycle[]).map((cycle) => {
                const Icon = cycle === "per_term" ? CalendarDays : Calendar;
                const isCurrent = sub.billing_cycle === cycle;
                return (
                  <div
                    key={cycle}
                    className={`flex items-start gap-4 rounded-2xl border p-5 transition ${
                      isCurrent
                        ? "border-blue-200 bg-blue-50"
                        : "border-slate-200 bg-white opacity-50"
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isCurrent
                          ? "bg-blue-100 text-blue-600"
                          : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <div className={`text-sm font-semibold ${isCurrent ? "text-blue-900" : "text-slate-600"}`}>
                          {cycle === "per_term" ? "Per Term" : "Full Year"}
                        </div>
                        {isCurrent && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Your plan
                          </span>
                        )}
                      </div>
                      <p className={`mt-0.5 text-xs leading-relaxed ${isCurrent ? "text-blue-700" : "text-slate-400"}`}>
                        {cycle === "per_term"
                          ? "Pay at the start of each school term. Three payments per academic year. Flexible and easier to budget term-by-term."
                          : "Pay once at the start of the academic year. Typically includes a discount compared to per-term billing. Best value for committed schools."}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Payment history ── */}
        {!loading && !err && sub && (
          <>
            <SectionLabel>Payment History</SectionLabel>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-slate-400" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Payment History</h2>
                    <p className="mt-0.5 text-xs text-slate-400">
                      All M-Pesa payments for this subscription
                    </p>
                  </div>
                </div>
                {history.length > 0 && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                    {history.length} record{history.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              <div className="divide-y divide-slate-50">
                {histLoading && (
                  <div className="space-y-2 p-5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full rounded-xl" />
                    ))}
                  </div>
                )}

                {!histLoading && history.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                      <Receipt className="h-5 w-5 text-slate-300" />
                    </div>
                    <p className="text-sm text-slate-400">No payments recorded yet.</p>
                    <p className="text-xs text-slate-300">Payments will appear here after your first M-Pesa transaction.</p>
                  </div>
                )}

                {!histLoading &&
                  history.map((p) => (
                    <div key={p.id} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          p.status === "completed"
                            ? "bg-emerald-50 text-emerald-600"
                            : p.status === "failed"
                            ? "bg-red-50 text-red-500"
                            : "bg-amber-50 text-amber-500"
                        }`}
                      >
                        {p.status === "completed" && <CheckCircle className="h-4 w-4" />}
                        {p.status === "failed"    && <XCircle className="h-4 w-4" />}
                        {p.status === "pending"   && <Loader2 className="h-4 w-4 animate-spin" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">
                            {formatKes(p.amount_kes)}
                          </span>
                          {p.period_label && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                              {p.period_label}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-400">
                          <span>{formatDateShort(p.paid_at)}</span>
                          {p.phone && <span>· {p.phone}</span>}
                          {p.mpesa_receipt && (
                            <span className="font-mono text-slate-500">{p.mpesa_receipt}</span>
                          )}
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          p.status === "completed"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : p.status === "failed"
                            ? "bg-red-50 text-red-600 ring-1 ring-red-200"
                            : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}