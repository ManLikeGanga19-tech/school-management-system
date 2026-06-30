"use client";

/**
 * ApplyScholarshipDialog — Path 3: director-only after-the-fact
 * scholarship application on an existing invoice.
 *
 * Calls POST /finance/invoices/{id}/scholarship. Backend rejects PAID +
 * CANCELLED invoices and refuses non-director callers.
 *
 * The Amount field is only shown for FIXED-type scholarships — PERCENTAGE
 * and FULL_WAIVER are auto-computed server-side from invoice total.
 */

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

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
import type { Scholarship } from "@/components/finance/finance-utils";

type Props = {
  open: boolean;
  invoice: {
    id: string;
    invoice_no?: string | null;
    status?: string | null;
    total_amount?: string | number;
  } | null;
  scholarships: Scholarship[];
  onClose: () => void;
  onApplied?: () => void;
};

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
      toast.success("Scholarship applied.");
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to apply scholarship");
    } finally {
      setSubmitting(false);
    }
  }

  const activeScholarships = scholarships.filter((s) => s.is_active);
  const isBlockedStatus =
    invoice?.status === "PAID" || invoice?.status === "CANCELLED";

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
            . Director-only action — audit recorded.
          </DialogDescription>
        </DialogHeader>

        {isBlockedStatus ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            This invoice is <strong>{invoice?.status}</strong> — issue a refund
            or void it before applying a scholarship.
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
                <strong>Full Waiver</strong> — invoice will be set to{" "}
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
