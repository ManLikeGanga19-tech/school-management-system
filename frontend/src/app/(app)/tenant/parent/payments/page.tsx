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

function providerBadge(p: string) {
  const colors: Record<string, string> = {
    MPESA: "bg-green-100 text-green-700",
    CASH:  "bg-slate-100 text-slate-700",
    BANK:  "bg-blue-100 text-blue-700",
    CHEQUE:"bg-purple-100 text-purple-700",
  };
  const labels: Record<string, string> = {
    MPESA: "M-Pesa", CASH: "Cash", BANK: "Bank Transfer", CHEQUE: "Cheque",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[p] || "bg-slate-100 text-slate-700"}`}>
      {labels[p] || p}
    </span>
  );
}

function PaymentsContent() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get("/portal/payments")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load payments");
        const data = await res.json();
        if (!cancelled) setPayments(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
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
          <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <AppShell title="Payments" nav={parentNav} activeHref="/tenant/parent/payments">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100">
            <Receipt className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Payment History</h1>
            <p className="text-sm text-slate-500">
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
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 text-center">
            <Receipt className="h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">No payments recorded yet.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Receipt / Ref</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((pay) => (
                  <tr key={pay.payment_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {fmtDate(pay.received_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {pay.student_name}
                    </td>
                    <td className="px-4 py-3">
                      {providerBadge(pay.provider)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {pay.receipt_no || pay.reference || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-800">
                      {kes(pay.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {payments.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td colSpan={4} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Total Paid
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-700">
                      {kes(totalPaid)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function ParentPaymentsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    }>
      <PaymentsContent />
    </Suspense>
  );
}
