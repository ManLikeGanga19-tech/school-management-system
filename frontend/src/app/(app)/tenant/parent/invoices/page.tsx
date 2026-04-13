"use client";

import { Suspense, useEffect, useState } from "react";
import { FileText, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { parentNav } from "@/components/layout/nav-config";
import { api } from "@/lib/api";

type InvoiceRow = {
  invoice_id: string;
  enrollment_id: string;
  student_name: string;
  class_code: string;
  invoice_type: string;
  invoice_no: string | null;
  status: string;
  term_number: number | null;
  academic_year: number | null;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  created_at: string | null;
};

function kes(n: number) {
  return `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusBadge(status: string, balance: number) {
  if (balance <= 0 || status === "PAID") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Paid
      </span>
    );
  }
  if (status === "PARTIAL") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
        Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
      <AlertCircle className="h-3 w-3" /> Unpaid
    </span>
  );
}

function InvoicesContent() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get("/portal/invoices")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load invoices");
        const data = await res.json();
        if (!cancelled) setInvoices(data);
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
      <AppShell title="My Bills" nav={parentNav} activeHref="/tenant/parent/invoices">
        <div className="flex min-h-[380px] items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  const outstanding = invoices.filter((i) => i.balance_amount > 0);
  const settled = invoices.filter((i) => i.balance_amount <= 0);

  return (
    <AppShell title="My Bills" nav={parentNav} activeHref="/tenant/parent/invoices">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
            <FileText className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Fee Invoices</h1>
            <p className="text-sm text-slate-500">
              {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} across all your children
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Outstanding */}
        {outstanding.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Outstanding ({outstanding.length})
            </h2>
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Term</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((inv) => (
                    <tr key={inv.invoice_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{inv.student_name}</p>
                        <p className="text-xs text-slate-400">{inv.class_code}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {inv.invoice_no || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {inv.term_number ? `Term ${inv.term_number}` : "—"}
                        {inv.academic_year ? ` ${inv.academic_year}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {kes(inv.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                        {kes(inv.paid_amount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-700">
                        {kes(inv.balance_amount)}
                      </td>
                      <td className="px-4 py-3">
                        {statusBadge(inv.status, inv.balance_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Settled */}
        {settled.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Settled ({settled.length})
            </h2>
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Term</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {settled.map((inv) => (
                    <tr key={inv.invoice_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-700">{inv.student_name}</p>
                        <p className="text-xs text-slate-400">{inv.class_code}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {inv.invoice_no || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {inv.term_number ? `Term ${inv.term_number}` : "—"}
                        {inv.academic_year ? ` ${inv.academic_year}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {kes(inv.total_amount)}
                      </td>
                      <td className="px-4 py-3">
                        {statusBadge(inv.status, inv.balance_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {invoices.length === 0 && !error && (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 text-center">
            <FileText className="h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">No invoices found.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function ParentInvoicesPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    }>
      <InvoicesContent />
    </Suspense>
  );
}
