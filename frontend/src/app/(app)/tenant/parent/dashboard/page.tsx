"use client";

import { Suspense, useEffect, useState } from "react";
import {
  GraduationCap,
  Wallet,
  Receipt,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { parentNav } from "@/components/layout/nav-config";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type ChildSummary = {
  link_id: string;
  enrollment_id: string;
  student_name: string;
  class_code: string;
  admission_number: string | null;
  outstanding: number;
};

type ParentMe = {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  phone: string;
  email: string | null;
  school_name: string;
  children: ChildSummary[];
  outstanding_total: number;
  child_count: number;
};

type RecentPayment = {
  payment_id: string;
  receipt_no: string | null;
  provider: string;
  reference: string | null;
  amount: number;
  student_name: string;
  received_at: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function kes(n: number) {
  return `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function providerLabel(p: string) {
  const map: Record<string, string> = { MPESA: "M-Pesa", CASH: "Cash", BANK: "Bank", CHEQUE: "Cheque" };
  return map[p] || p;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-800 truncate">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        <div className={`shrink-0 rounded-xl p-2.5 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function ChildCard({ child }: { child: ChildSummary }) {
  const isPaid = child.outstanding <= 0;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
          <GraduationCap className="h-5 w-5 text-blue-600" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 truncate">{child.student_name}</p>
          <p className="text-xs text-slate-500">
            {child.class_code}
            {child.admission_number && <> &middot; {child.admission_number}</>}
          </p>
        </div>
      </div>

      {/* Fee status */}
      <div className={`rounded-xl px-4 py-3 flex items-center justify-between gap-2 ${
        isPaid ? "bg-emerald-50" : "bg-amber-50"
      }`}>
        <div>
          <p className="text-xs font-medium text-slate-500">
            {isPaid ? "Balance" : "Amount Due"}
          </p>
          <p className={`text-lg font-bold ${isPaid ? "text-emerald-700" : "text-amber-700"}`}>
            {isPaid ? "Fully Paid" : kes(child.outstanding)}
          </p>
        </div>
        {isPaid
          ? <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" />
          : <AlertCircle className="h-6 w-6 text-amber-500 shrink-0" />
        }
      </div>
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function ParentDashboardContent() {
  const [me, setMe] = useState<ParentMe | null>(null);
  const [payments, setPayments] = useState<RecentPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [meData, payData] = await Promise.all([
          api.get<ParentMe>("/portal/me", { tenantRequired: true }),
          api.get<RecentPayment[]>("/portal/payments", { tenantRequired: true }).catch(() => [] as RecentPayment[]),
        ]);
        if (cancelled) return;
        setMe(meData);
        setPayments(payData.slice(0, 10));
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <AppShell title="Parent Portal" nav={parentNav} activeHref="/tenant/parent/dashboard">
        <div className="flex min-h-[380px] items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (error || !me) {
    return (
      <AppShell title="Parent Portal" nav={parentNav} activeHref="/tenant/parent/dashboard">
        <div className="flex min-h-[380px] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="font-medium text-slate-700">Unable to load your portal</p>
          <p className="text-sm text-slate-500">{error || "No parent account linked to this login."}</p>
        </div>
      </AppShell>
    );
  }

  const outstandingChildren = me.children.filter((c) => c.outstanding > 0);

  return (
    <AppShell title="Parent Portal" nav={parentNav} activeHref="/tenant/parent/dashboard">
      <div className="space-y-7">

        {/* ── Hero banner ── */}
        <div className="dashboard-hero rounded-[2rem] p-6 text-white shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-white/70">{me.school_name}</p>
              <h1 className="text-2xl font-bold tracking-tight">
                Welcome, {me.first_name}!
              </h1>
              <p className="mt-1 text-sm text-white/70">
                {me.child_count === 1
                  ? "1 child enrolled"
                  : `${me.child_count} children enrolled`}
              </p>
            </div>
            {me.outstanding_total > 0 && (
              <div className="mt-4 sm:mt-0 rounded-xl bg-white/15 px-5 py-3 text-right backdrop-blur-sm">
                <p className="text-xs text-white/70 font-medium">Total Outstanding</p>
                <p className="text-xl font-bold">{kes(me.outstanding_total)}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Summary stats ── */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Children"
            value={String(me.child_count)}
            sub={me.child_count === 1 ? "enrolled student" : "enrolled students"}
            icon={Users}
            accent="bg-blue-100 text-blue-600"
          />
          <StatCard
            label="Total Outstanding"
            value={me.outstanding_total > 0 ? kes(me.outstanding_total) : "Fully Paid"}
            sub={outstandingChildren.length > 0
              ? `${outstandingChildren.length} bill${outstandingChildren.length > 1 ? "s" : ""} pending`
              : "All fees settled"
            }
            icon={me.outstanding_total > 0 ? AlertCircle : CheckCircle2}
            accent={me.outstanding_total > 0 ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"}
          />
          <StatCard
            label="Recent Payments"
            value={String(payments.length)}
            sub="in payment history"
            icon={Receipt}
            accent="bg-purple-100 text-purple-600"
          />
        </div>

        {/* ── Children cards ── */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            My Children
          </h2>
          {me.children.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No children linked yet. Contact the school office.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {me.children.map((child) => (
                <ChildCard key={child.link_id} child={child} />
              ))}
            </div>
          )}
        </div>

        {/* ── Pending bills callout ── */}
        {outstandingChildren.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-amber-800">Outstanding Fees</p>
                <p className="mt-0.5 text-sm text-amber-700">
                  {outstandingChildren.length === 1
                    ? `${outstandingChildren[0].student_name} has an outstanding balance of ${kes(outstandingChildren[0].outstanding)}.`
                    : `${outstandingChildren.length} of your children have outstanding fee balances totalling ${kes(me.outstanding_total)}.`
                  }
                  {" "}Please visit the school office to make a payment.
                </p>
              </div>
              <a
                href="/tenant/parent/invoices"
                className="shrink-0 flex items-center gap-1 text-sm font-medium text-amber-700 hover:text-amber-900"
              >
                View Bills <ChevronRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        )}

        {/* ── Recent payments ── */}
        {payments.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Recent Payments
            </h2>
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((pay) => (
                    <tr key={pay.payment_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {fmtDate(pay.received_at)}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">{pay.student_name}</td>
                      <td className="px-4 py-3 text-slate-600">{providerLabel(pay.provider)}</td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                        {pay.receipt_no || pay.reference || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800 tabular-nums">
                        {kes(pay.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function ParentDashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    }>
      <ParentDashboardContent />
    </Suspense>
  );
}
