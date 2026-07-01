"use client";

/**
 * ApplyScholarshipDialog — apply a scholarship to an existing invoice.
 *
 * Backend contract (M1):
 *   POST /finance/invoices/{id}/scholarship
 *   - Gate:  finance.scholarships.manage (secretary + director both)
 *   - Blocks: CANCELLED only (PAID is allowed — surplus becomes an
 *             OVERPAYMENT_CREDIT carry-forward for the student)
 *   - Amount field required only for FIXED scholarships; PERCENTAGE and
 *     FULL_WAIVER are computed server-side from invoice total.
 *
 * The dialog shows the invoice's current numbers up front and warns when
 * the discount will create an overpayment credit — the operator sees
 * the outcome BEFORE clicking Apply (no silent surprises).
 */

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { formatKes, toNumber } from "@/lib/format";
import type { Scholarship } from "@/components/finance/finance-utils";

type Props = {
  open: boolean;
  invoice: {
    id: string;
    invoice_no?: string | null;
    status?: string | null;
    total_amount?: string | number;
    paid_amount?: string | number;
    balance_amount?: string | number;
  } | null;
  scholarships: Scholarship[];
  onClose: () => void;
  onApplied?: () => void;
};

function computePreviewDiscount(
  picked: Scholarship | undefined,
  invoiceTotal: number,
  amountInput: string,
): number {
  if (!picked) return 0;
  if (picked.type === "FULL_WAIVER") return invoiceTotal;
  if (picked.type === "PERCENTAGE") {
    const pct = toNumber(picked.value);
    return Math.round(((invoiceTotal * pct) / 100) * 100) / 100;
  }
  // FIXED — user-entered
  const requested = toNumber(amountInput);
  return Math.min(Math.max(requested, 0), invoiceTotal);
}

export function ApplyScholarshipDialog({
  open,
  invoice,
  scholarships,
  onClose,
  onApplied,
}: Props) {
  const [scholarshipId, setScholarshipId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Reset form whenever the dialog opens against a different invoice.
  useEffect(() => {
    if (open) {
      setScholarshipId("");
      setAmount("");
      setReason("");
    }
  }, [open, invoice?.id]);

  const picked = scholarships.find((s) => s.id === scholarshipId);
  const requiresAmount = picked?.type === "FIXED";
  const activeScholarships = scholarships.filter((s) => s.is_active);
  const isBlockedStatus = invoice?.status === "CANCELLED";

  // Financial preview — the operator sees the outcome before clicking Apply.
  const invoiceTotal = toNumber(invoice?.total_amount ?? 0);
  const invoicePaid = toNumber(invoice?.paid_amount ?? 0);
  const previewDiscount = useMemo(
    () => computePreviewDiscount(picked, invoiceTotal, amount),
    [picked, invoiceTotal, amount],
  );
  const previewNewTotal = Math.max(0, invoiceTotal - previewDiscount);
  const previewSurplus = Math.max(0, invoicePaid - previewNewTotal);
  const previewNewBalance = Math.max(0, previewNewTotal - invoicePaid);

  async function submit() {
    if (!invoice) return;
    if (!scholarshipId) {
      toast.error("Pick a scholarship first.");
      return;
    }
    if (!reason.trim()) {
      toast.error("A reason is required for audit.");
      return;
    }
    if (requiresAmount && (!amount.trim() || Number(amount) <= 0)) {
      toast.error("Amount must be greater than 0 for a FIXED scholarship.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post<unknown>(
        `/finance/invoices/${invoice.id}/scholarship`,
        {
          scholarship_id: scholarshipId,
          reason: reason.trim(),
          ...(requiresAmount ? { amount: amount.trim() } : {}),
        },
        { tenantRequired: true },
      );
      toast.success(
        previewSurplus > 0
          ? `Scholarship applied. KES ${previewSurplus.toLocaleString()} credited to student.`
          : "Scholarship applied.",
      );
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to apply scholarship");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#173f49]" />
            Apply Scholarship
          </DialogTitle>
          <DialogDescription>
            Apply a scholarship to invoice{" "}
            <span className="font-mono text-slate-700">
              {invoice?.invoice_no ?? invoice?.id?.slice(0, 8)}
            </span>
            . Audit recorded.
          </DialogDescription>
        </DialogHeader>

        {/* Current invoice financial snapshot — shown up front so the
            operator anchors the discount against real numbers. */}
        {invoice && (
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-center text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Total
              </div>
              <div className="font-semibold text-slate-700">
                {formatKes(invoiceTotal)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Paid
              </div>
              <div className="font-semibold text-emerald-700">
                {formatKes(invoicePaid)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Balance
              </div>
              <div className="font-semibold text-red-600">
                {formatKes(toNumber(invoice?.balance_amount ?? 0))}
              </div>
            </div>
          </div>
        )}

        {isBlockedStatus ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            This invoice is <strong>{invoice?.status}</strong> — un-void it
            first, or apply to the replacement invoice.
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Scholarship</Label>
              <Select value={scholarshipId} onValueChange={setScholarshipId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a scholarship" />
                </SelectTrigger>
                <SelectContent>
                  {activeScholarships.length === 0 && (
                    <div className="px-2 py-1 text-xs text-slate-400">
                      No active scholarships defined.
                    </div>
                  )}
                  {activeScholarships.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {s.type.replace(/_/g, " ").toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {requiresAmount && (
              <div className="space-y-1.5">
                <Label>Amount (KES)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="e.g. 3000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            )}

            {picked?.type === "FULL_WAIVER" && (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
                <strong>Full Waiver</strong> — invoice total set to{" "}
                <strong>KES 0</strong>
                {picked.covers_carry_forward
                  ? " including any carry-forward arrears."
                  : " for the current term (arrears stay billed)."}
              </div>
            )}
            {picked?.type === "PERCENTAGE" && (
              <p className="text-xs text-slate-500">
                Auto-computed as {Number(picked.value)}% of the invoice total.
              </p>
            )}

            {/* Financial preview — outcome BEFORE clicking Apply. */}
            {picked && (
              <div className="space-y-1 rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>Discount applied</span>
                  <span className="font-semibold text-slate-700">
                    −{formatKes(previewDiscount)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>New invoice total</span>
                  <span className="font-semibold text-slate-800">
                    {formatKes(previewNewTotal)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>New balance</span>
                  <span className="font-semibold text-slate-800">
                    {formatKes(previewNewBalance)}
                  </span>
                </div>
                {previewSurplus > 0 && (
                  <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-amber-800">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      Parent already paid <strong>{formatKes(invoicePaid)}</strong>.
                      The surplus of <strong>{formatKes(previewSurplus)}</strong>{" "}
                      will be booked as an overpayment credit on the student's
                      account (redeemable against future invoices).
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Reason (audit)</Label>
              <Textarea
                rows={2}
                placeholder="Why is this scholarship being awarded?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || isBlockedStatus}
            className="bg-[#173f49] text-white hover:bg-[#0f2f37]"
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
