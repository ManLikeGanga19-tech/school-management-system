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

function normalizeType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatusBadge({ status, balance }: { status: string; balance: number }) {
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

function InvoiceCard({ inv, outstanding }: { inv: InvoiceRow; outstanding: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${outstanding ? "border-amber-100" : "border-slate-100"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 truncate">{inv.student_name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {inv.class_code}
            {inv.invoice_no && <> &middot; <span className="font-mono">{inv.invoice_no}</span></>}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {normalizeType(inv.invoice_type)}
            {inv.term_number ? ` · Term ${inv.term_number}` : ""}
            {inv.academic_year ? ` ${inv.academic_year}` : ""}
          </p>
        </div>
        <StatusBadge status={inv.status} balance={inv.balance_amount} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 px-3 py-2 text-center text-xs">
        <div>
          <p className="text-slate-400">Total</p>
          <p className="font-semibold text-slate-700 tabular-nums">{kes(inv.total_amount)}</p>
        </div>
        <div>
          <p className="text-slate-400">Paid</p>
          <p className="font-semibold text-emerald-700 tabular-nums">{kes(inv.paid_amount)}</p>
        </div>
        <div>
          <p className="text-slate-400">Balance</p>
          <p className={`font-bold tabular-nums ${outstanding ? "text-amber-700" : "text-slate-400"}`}>
            {kes(inv.balance_amount)}
          </p>
        </div>
      </div>
    </div>
  );
}

function InvoiceSection({
  title,
  invoices,
  outstanding,
}: {
  title: string;
  invoices: InvoiceRow[];
  outstanding: boolean;
}) {
  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} ({invoices.length})
      </h2>

      {/* Mobile: card list */}
      <div className="space-y-3 sm:hidden">
        {invoices.map((inv) => (
          <InvoiceCard key={inv.invoice_id} inv={inv} outstanding={outstanding} />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Type / Term</th>
              {outstanding && <th className="px-4 py-3 text-right">Total</th>}
              {outstanding && <th className="px-4 py-3 text-right">Paid</th>}
              <th className="px-4 py-3 text-right">{outstanding ? "Balance" : "Amount"}</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.invoice_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{inv.student_name}</p>
                  <p className="text-xs text-slate-400">{inv.class_code}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">
                  {inv.invoice_no || "—"}
                </td>
                <td className="px-4 py-3 text-slate-600 text-xs">
                  {normalizeType(inv.invoice_type)}
                  {inv.term_number ? <><br />Term {inv.term_number}{inv.academic_year ? ` · ${inv.academic_year}` : ""}</> : ""}
                </td>
                {outstanding && (
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{kes(inv.total_amount)}</td>
                )}
                {outstanding && (
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{kes(inv.paid_amount)}</td>
                )}
                <td className={`px-4 py-3 text-right tabular-nums font-bold ${outstanding ? "text-amber-700" : "text-slate-700"}`}>
                  {outstanding ? kes(inv.balance_amount) : kes(inv.total_amount)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={inv.status} balance={inv.balance_amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoicesContent() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<InvoiceRow[]>("/portal/invoices", { tenantRequired: true })
      .then((data) => {
        if (!cancelled) setInvoices(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load invoices");
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
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 shrink-0">
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

        {outstanding.length > 0 && (
          <InvoiceSection title="Outstanding" invoices={outstanding} outstanding={true} />
        )}

        {settled.length > 0 && (
          <InvoiceSection title="Settled" invoices={settled} outstanding={false} />
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
