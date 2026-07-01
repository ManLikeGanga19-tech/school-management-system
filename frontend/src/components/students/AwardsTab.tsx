"use client";

/**
 * AwardsTab — student profile view of scholarship grants + allocation history.
 *
 * Two data sources:
 *   1. GET /finance/students/{id}/scholarship-grants  — the grant records
 *      (Phase M2). One grant per (student, scholarship) — ACTIVE or REVOKED.
 *   2. GET /finance/students/{id}/scholarships         — the allocation
 *      history (Phase F2). Each allocation = one invoice application.
 *
 * The tab shows grants at the top ("current awards + past awards") and the
 * allocation ledger below. A director / secretary with
 * finance.scholarships.manage can revoke an active grant inline.
 *
 * All money is displayed here — this is the student's own record, not a
 * page-level aggregate. Per RBAC established in Phase G2 the secretary
 * doesn't see PAGE-level money aggregates, but individual student
 * awards ARE personal record and are shown.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GraduationCap,
  Loader2,
  Sparkles,
  History,
  ShieldOff,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
import { formatKes } from "@/lib/format";
import { usePermissions } from "@/lib/auth/usePermissions";

type Grant = {
  grant_id: string;
  status: "ACTIVE" | "REVOKED";
  academic_year: number | null;
  term_number: number | null;
  granted_reason: string;
  granted_at: string | null;
  revoked_reason: string | null;
  revoked_at: string | null;
  scholarship_id: string | null;
  scholarship_name: string;
  scholarship_type: string;
  scholarship_value: string | number;
  max_recipients: number | null;
  covers_carry_forward: boolean;
};

type Allocation = {
  allocation_id: string;
  scholarship_id: string | null;
  scholarship_name: string;
  scholarship_type: string;
  amount: string | number;
  reason: string;
  status: string;
  invoice_id: string | null;
  invoice_no: string;
  term_number: number | null;
  academic_year: number | null;
  created_at: string | null;
};

type Props = {
  studentId: string;
  onGrantChanged?: () => void;
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-KE", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return "—";
  }
}

function typeLabel(t: string): string {
  return t.replace(/_/g, " ").toLowerCase();
}

function scopeLabel(g: Grant): string {
  const parts: string[] = [];
  if (g.term_number != null) parts.push(`Term ${g.term_number}`);
  if (g.academic_year != null) parts.push(String(g.academic_year));
  return parts.length ? parts.join(" · ") : "All terms";
}

function grantValueLabel(g: Grant): string {
  if (g.scholarship_type === "FULL_WAIVER") {
    return g.covers_carry_forward ? "100% + arrears" : "100% current term";
  }
  if (g.scholarship_type === "PERCENTAGE") {
    return `${Number(g.scholarship_value)}%`;
  }
  return formatKes(Number(g.scholarship_value));
}

export function AwardsTab({ studentId, onGrantChanged }: Props) {
  const { has } = usePermissions();
  const canManage = has("finance.scholarships.manage");

  const [grants, setGrants] = useState<Grant[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [grantsResp, allocResp] = await Promise.all([
        api.get<{ grants?: Grant[] }>(
          `/finance/students/${studentId}/scholarship-grants`,
          { tenantRequired: true, noRedirect: true },
        ),
        api.get<{ allocations?: Allocation[] }>(
          `/finance/students/${studentId}/scholarships`,
          { tenantRequired: true, noRedirect: true },
        ),
      ]);
      setGrants(Array.isArray(grantsResp?.grants) ? grantsResp.grants : []);
      setAllocations(
        Array.isArray(allocResp?.allocations) ? allocResp.allocations : [],
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load awards");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeGrants = useMemo(
    () => grants.filter((g) => g.status === "ACTIVE"),
    [grants],
  );
  const revokedGrants = useMemo(
    () => grants.filter((g) => g.status === "REVOKED"),
    [grants],
  );

  async function confirmRevoke() {
    if (!revoking) return;
    if (!revokeReason.trim()) {
      toast.error("A revocation reason is required for audit.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post<unknown>(
        `/finance/students/${studentId}/scholarship-grants/${revoking.grant_id}/revoke`,
        { reason: revokeReason.trim() },
        { tenantRequired: true },
      );
      toast.success("Grant revoked.");
      setRevoking(null);
      setRevokeReason("");
      await load();
      onGrantChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke grant");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading awards…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-slate-400" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Scholarships & Awards
            </h2>
            <p className="text-xs text-slate-400">
              Grants attach a scholarship to the student — every subsequent
              invoice inherits the discount automatically.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="h-8"
        >
          <RefreshCw className="mr-1.5 h-3 w-3" />
          Refresh
        </Button>
      </div>

      {/* ACTIVE grants */}
      <div className="rounded-xl border border-emerald-100 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/40 px-4 py-3">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Active Grants ({activeGrants.length})
            </h3>
            <p className="text-xs text-slate-500">
              Currently in force. Auto-applies on every matching invoice.
            </p>
          </div>
        </div>
        {activeGrants.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            No active scholarships on this student.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Scholarship</TableHead>
                <TableHead className="text-xs">Type / Value</TableHead>
                <TableHead className="text-xs">Scope</TableHead>
                <TableHead className="text-xs">Granted</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
                {canManage && (
                  <TableHead className="text-right text-xs">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeGrants.map((g) => (
                <TableRow key={g.grant_id}>
                  <TableCell className="text-sm font-medium text-slate-800">
                    {g.scholarship_name}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">
                      {typeLabel(g.scholarship_type)}
                    </span>{" "}
                    <span className="text-slate-500">{grantValueLabel(g)}</span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {scopeLabel(g)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatDate(g.granted_at)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {g.granted_reason}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-red-600 hover:bg-red-50"
                        onClick={() => {
                          setRevoking(g);
                          setRevokeReason("");
                        }}
                      >
                        <ShieldOff className="mr-1 h-3 w-3" />
                        Revoke
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* REVOKED history (audit) */}
      {revokedGrants.length > 0 && (
        <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <History className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">
              Revoked Grants ({revokedGrants.length})
            </h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Scholarship</TableHead>
                <TableHead className="text-xs">Scope</TableHead>
                <TableHead className="text-xs">Granted</TableHead>
                <TableHead className="text-xs">Revoked</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revokedGrants.map((g) => (
                <TableRow key={g.grant_id} className="text-slate-500">
                  <TableCell className="text-sm">{g.scholarship_name}</TableCell>
                  <TableCell className="text-xs">{scopeLabel(g)}</TableCell>
                  <TableCell className="text-xs">
                    {formatDate(g.granted_at)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatDate(g.revoked_at)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {g.revoked_reason || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Allocation ledger — per-invoice applications */}
      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <History className="h-4 w-4 text-slate-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Allocation Ledger ({allocations.length})
            </h3>
            <p className="text-xs text-slate-500">
              Every time a scholarship was applied to one of this student's
              invoices — auto or manual.
            </p>
          </div>
        </div>
        {allocations.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            No scholarship allocations recorded for this student yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Invoice</TableHead>
                <TableHead className="text-xs">Term / Year</TableHead>
                <TableHead className="text-xs">Scholarship</TableHead>
                <TableHead className="text-right text-xs">Amount</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.map((a) => (
                <TableRow key={a.allocation_id}>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {a.invoice_no || (a.invoice_id ? a.invoice_id.slice(0, 8) : "—")}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {a.term_number != null && a.academic_year != null
                      ? `T${a.term_number} · ${a.academic_year}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-800">
                    {a.scholarship_name}
                    <span className="ml-1 text-xs text-slate-400">
                      {typeLabel(a.scholarship_type)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium text-emerald-700">
                    {formatKes(Number(a.amount))}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        a.status === "ACTIVE"
                          ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
                          : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200"
                      }
                    >
                      {a.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatDate(a.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Revoke dialog */}
      <Dialog
        open={revoking !== null}
        onOpenChange={(v) => !v && setRevoking(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-red-600" />
              Revoke Grant
            </DialogTitle>
            <DialogDescription>
              Revoke <strong>{revoking?.scholarship_name}</strong> for this
              student. Past allocations stay — this only stops future invoices
              from inheriting the scholarship. You can re-grant it later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label>Reason (audit)</Label>
            <Textarea
              rows={3}
              placeholder="Why is this grant being revoked?"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRevoking(null)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => void confirmRevoke()}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldOff className="mr-2 h-4 w-4" />
              )}
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
