"use client";

import { Suspense, useEffect, useState } from "react";
import { Receipt, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { parentNav } from "@/components/layout/nav-config";
import { api } from "@/lib/api";

type PaymentRow = {
  payment_id: string;
  receipt_no: string | null;
  provider: string;
  reference: string | null;
  amount: number;
  student_name: string;
  received_at: string | null;
};

function kes(n: number) {
  return `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function ProviderBadge({ p }: { p: string }) {
  const colors: Record<string, string> = {
    MPESA:  "bg-green-100 text-green-700",
    CASH:   "bg-slate-100 text-[var(--tenant-ink)]",
    BANK:   "bg-blue-100 text-blue-700",
    CHEQUE: "bg-purple-100 text-purple-700",
  };
  const labels: Record<string, string> = {
    MPESA: "M-Pesa", CASH: "Cash", BANK: "Bank Transfer", CHEQUE: "Cheque",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[p] ?? "bg-slate-100 text-[var(--tenant-ink)]"}`}>
      {labels[p] ?? p}
    </span>
  );
}

function PaymentsContent() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<PaymentRow[]>("/portal/payments", { tenantRequired: true })
      .then((data) => {
        if (!cancelled) setPayments(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load payments");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <AppShell title="Payments" nav={parentNav} activeHref="/tenant/parent/payments">
        <div className="flex min-h-[380px] items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[var(--tenant-muted)]" />
        </div>
      </AppShell>
    );
  }

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <AppShell title="Payments" nav={parentNav} activeHref="/tenant/parent/payments">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--tenant-surface-2)] shrink-0">
            <Receipt className="h-5 w-5 text-[var(--tenant-primary)]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--tenant-ink)]">Payment History</h1>
            <p className="text-sm text-[var(--tenant-muted)]">
              {payments.length} payment{payments.length !== 1 ? "s" : ""}
              {totalPaid > 0 && ` · ${kes(totalPaid)} total paid`}
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {payments.length === 0 && !error ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--tenant-border)] text-center">
            <Receipt className="h-10 w-10 text-[var(--tenant-muted)] opacity-50" />
            <p className="text-sm text-[var(--tenant-muted)]">No payments recorded yet.</p>
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="space-y-3 sm:hidden">
              {payments.map((pay) => (
                <div key={pay.payment_id} className="rounded-xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--tenant-ink)] truncate">{pay.student_name}</p>
                      <p className="text-xs text-[var(--tenant-muted)] mt-0.5">{fmtDate(pay.received_at)}</p>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <ProviderBadge p={pay.provider} />
                        {(pay.receipt_no || pay.reference) && (
                          <span className="font-mono text-xs text-[var(--tenant-muted)]">
                            {pay.receipt_no || pay.reference}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="font-bold tabular-nums text-[var(--tenant-ink)] shrink-0 text-base">
                      {kes(pay.amount)}
                    </p>
                  </div>
                </div>
              ))}
              {/* Mobile total */}
              <div className="rounded-xl border border-[var(--tenant-border)] bg-[var(--tenant-surface-2)] px-4 py-3 flex justify-between text-sm font-semibold text-[var(--tenant-ink)]">
                <span>Total Paid</span>
                <span className="text-emerald-700 tabular-nums">{kes(totalPaid)}</span>
              </div>
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block rounded-2xl border border-[var(--tenant-border)] bg-[var(--tenant-surface)] shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--tenant-border)] bg-[var(--tenant-surface-2)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--tenant-muted)]">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Receipt / Ref</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((pay) => (
                    <tr key={pay.payment_id} className="border-b border-[var(--tenant-border)] last:border-0 hover:bg-[var(--tenant-surface-2)]">
                      <td className="px-4 py-3 text-[var(--tenant-muted)] whitespace-nowrap">{fmtDate(pay.received_at)}</td>
                      <td className="px-4 py-3 font-medium text-[var(--tenant-ink)]">{pay.student_name}</td>
                      <td className="px-4 py-3"><ProviderBadge p={pay.provider} /></td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--tenant-muted)]">
                        {pay.receipt_no || pay.reference || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-[var(--tenant-ink)]">
                        {kes(pay.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--tenant-border)] bg-[var(--tenant-surface-2)]">
                    <td colSpan={4} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--tenant-muted)]">
                      Total Paid
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-700">
                      {kes(totalPaid)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default function ParentPaymentsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[var(--tenant-muted)]" />
      </div>
    }>
      <PaymentsContent />
    </Suspense>
  );
}
