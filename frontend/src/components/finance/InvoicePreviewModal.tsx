"use client";

/**
 * InvoicePreviewModal
 *
 * Opens immediately after a fees invoice is generated (DRAFT). Shows the
 * full breakdown — student identity, term, line-by-line items (arrears
 * rollup + per-fee-item + interview credit + scholarship), totals — so the
 * secretary can confirm the right structure was used BEFORE publishing.
 *
 * Two paths out:
 *   • "Save as Draft" — close. The invoice sits in the Invoices table
 *     flagged DRAFT and can be replaced or discarded later.
 *   • "Publish & Send" — calls POST /finance/invoices/{id}/publish, which
 *     also fires the parent SMS notification. Closes on success.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

// ── Types ────────────────────────────────────────────────────────────────────

type LineMeta = {
  line_type?: string;
  fee_item_code?: string;
  fee_item_name?: string;
  charge_frequency?: string;
  scholarship_id?: string;
  carry_forward_ids?: string[];
};

type InvoiceLine = {
  id: string;
  description: string;
  amount: string | number;
  meta?: LineMeta | null;
};

export type InvoicePreviewData = {
  id: string;
  invoice_no: string | null;
  invoice_type: string;
  status: string;
  enrollment_id: string | null;
  term_number: number | null;
  academic_year: number | null;
  student_type_snapshot: string | null;
  currency: string;
  total_amount: string | number;
  paid_amount: string | number;
  balance_amount: string | number;
  meta?: Record<string, unknown> | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoicePreviewData | null;
  /** Identity strip ("Student · ADM · Class"). Optional. */
  studentLabel?: string | null;
  /** Called after a successful publish or save-as-draft so the parent page
   *  can refresh the invoices table. */
  onSaved?: () => void;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtKes(value: string | number): string {
  const n = parseFloat(String(value));
  if (Number.isNaN(n)) return "KES 0.00";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  return `${sign}KES ${abs.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function lineKind(line: InvoiceLine): {
  label: string;
  tone: "arrears" | "credit" | "scholarship" | "fee";
} {
  const meta = line.meta || {};
  if (meta.line_type === "CARRY_FORWARD_ROLLUP") {
    const amount = parseFloat(String(line.amount));
    return amount < 0
      ? { label: "Credit (brought fwd)", tone: "credit" }
      : { label: "Arrears (brought fwd)", tone: "arrears" };
  }
  if (meta.line_type === "INTERVIEW_CREDIT") {
    return { label: "Interview credit", tone: "credit" };
  }
  if (meta.scholarship_id) {
    return { label: "Scholarship", tone: "scholarship" };
  }
  return { label: "Fee line", tone: "fee" };
}

// ── Component ────────────────────────────────────────────────────────────────

export function InvoicePreviewModal({
  open,
  onOpenChange,
  invoice,
  studentLabel,
  onSaved,
}: Props) {
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Load lines whenever a new invoice id appears.
  const loadLines = useCallback(async (invoiceId: string) => {
    setLinesLoading(true);
    try {
      const data = await api.get<{ lines?: InvoiceLine[] } | InvoiceLine[]>(
        `/finance/invoices/${encodeURIComponent(invoiceId)}/lines`,
        { tenantRequired: true, noRedirect: true },
      ).catch(async () => {
        // Fallback: pull lines off the document payload.
        const doc = await api.get<{ lines?: InvoiceLine[] }>(
          `/finance/documents/invoices/${encodeURIComponent(invoiceId)}`,
          { tenantRequired: true },
        );
        return doc;
      });
      const arr = Array.isArray(data) ? data : (data?.lines ?? []);
      setLines(arr);
    } catch {
      setLines([]);
    } finally {
      setLinesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && invoice?.id) {
      void loadLines(invoice.id);
    } else if (!open) {
      setLines([]);
    }
  }, [open, invoice?.id, loadLines]);

  const arrearsTotal = useMemo(() => {
    const v = invoice?.meta?.["arrears_total"];
    return typeof v === "string" || typeof v === "number" ? parseFloat(String(v)) : 0;
  }, [invoice?.meta]);

  const currentTermTotal = useMemo(() => {
    const v = invoice?.meta?.["current_term_total"];
    return typeof v === "string" || typeof v === "number" ? parseFloat(String(v)) : 0;
  }, [invoice?.meta]);

  async function publish() {
    if (!invoice?.id) return;
    setPublishing(true);
    try {
      await api.post(
        `/finance/invoices/${encodeURIComponent(invoice.id)}/publish`,
        undefined,
        { tenantRequired: true },
      );
      toast.success("Invoice published. Parent will be notified.");
      onSaved?.();
      onOpenChange(false);
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message;
      toast.error(detail || "Failed to publish invoice.");
    } finally {
      setPublishing(false);
    }
  }

  function saveAsDraft() {
    toast.success("Saved as draft. Find it in the Invoices table to publish later.");
    onSaved?.();
    onOpenChange(false);
  }

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600" />
            Preview &amp; Publish Invoice
          </DialogTitle>
          <DialogDescription>
            Review the line items below before publishing. Save as draft if
            you need to fix the structure or scholarship first — only published
            invoices are visible to the parent and can be paid against.
          </DialogDescription>
        </DialogHeader>

        {/* Header strip — student + term + invoice no */}
        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              {studentLabel && (
                <p className="text-sm font-semibold text-slate-800">{studentLabel}</p>
              )}
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-mono text-blue-700">{invoice.invoice_no || invoice.id.slice(0, 8)}</span>
                <span>·</span>
                <span>Term {invoice.term_number ?? "—"} · {invoice.academic_year ?? "—"}</span>
                {invoice.student_type_snapshot && (
                  <>
                    <span>·</span>
                    <span className="rounded-full bg-white px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[10px] text-slate-700 ring-1 ring-slate-200">
                      {invoice.student_type_snapshot}
                    </span>
                  </>
                )}
                <span>·</span>
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[10px] text-amber-800 ring-1 ring-amber-200">
                  {invoice.status}
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Total</p>
              <p className="text-lg font-bold text-slate-900">{fmtKes(invoice.total_amount)}</p>
            </div>
          </div>

          {(arrearsTotal !== 0 || currentTermTotal !== 0) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className={`rounded-lg border px-3 py-1.5 text-[11px] ${
                arrearsTotal > 0
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : arrearsTotal < 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-700"
              }`}>
                <div className="font-semibold uppercase tracking-wide text-[10px] opacity-70">
                  Brought-forward
                </div>
                <div className="font-bold">{fmtKes(arrearsTotal)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-700">
                <div className="font-semibold uppercase tracking-wide text-[10px] opacity-70">
                  Current term
                </div>
                <div className="font-bold">{fmtKes(currentTermTotal)}</div>
              </div>
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="rounded-2xl border border-slate-100">
          <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
            Line items
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs">Kind</TableHead>
                  <TableHead className="text-xs text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linesLoading && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-xs text-slate-400">
                      Loading lines…
                    </TableCell>
                  </TableRow>
                )}
                {!linesLoading && lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-xs text-slate-400">
                      No lines on this invoice.
                    </TableCell>
                  </TableRow>
                )}
                {!linesLoading && lines.map((line) => {
                  const kind = lineKind(line);
                  const tone =
                    kind.tone === "credit" || kind.tone === "scholarship"
                      ? "text-emerald-700"
                      : kind.tone === "arrears"
                        ? "text-amber-700"
                        : "text-slate-700";
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="text-sm">{line.description}</TableCell>
                      <TableCell className="text-[10px] uppercase tracking-wide text-slate-500">
                        {kind.label}
                      </TableCell>
                      <TableCell className={`text-right text-sm font-medium ${tone}`}>
                        {fmtKes(line.amount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Action row */}
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3 w-3" />
            Publishing notifies the parent (SMS) and unlocks payment recording.
          </p>
          <p className="mt-0.5 text-blue-700">
            If the structure or scholarship looks wrong, save as draft and use
            Replace structure (director) before publishing.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={saveAsDraft} disabled={publishing}>
            <CircleDollarSign className="h-3.5 w-3.5" />
            Save as Draft
          </Button>
          <Button onClick={() => void publish()} disabled={publishing}>
            {publishing ? (
              "Publishing…"
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Publish &amp; Send
              </>
            )}
          </Button>
        </DialogFooter>

        {invoice.status !== "DRAFT" && (
          <p className="flex items-center gap-1.5 text-[11px] text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            This invoice is already {invoice.status.toLowerCase()}.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
