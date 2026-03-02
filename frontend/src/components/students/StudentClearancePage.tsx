"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, Search, ShieldCheck } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  normalizeStudentClearanceRows,
  type StudentClearanceRow,
} from "@/lib/students-clearance";

type StudentClearancePageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  roleContext: "secretary" | "director";
};

type WorkflowFilter =
  | "all"
  | "ready_request"
  | "pending_approval"
  | "approved_transfer"
  | "grade9";

const PAGE_SIZE = 12;

const WORKFLOW_OPTIONS: Array<{ value: WorkflowFilter; label: string }> = [
  { value: "all", label: "All workflows" },
  { value: "ready_request", label: "Ready for request" },
  { value: "pending_approval", label: "Pending director approval" },
  { value: "approved_transfer", label: "Approved transfers" },
  { value: "grade9", label: "Grade 9 candidates" },
];

function formatKes(value: string): string {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? parsed : 0;
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(safeValue);
}

function formatIsoDateTime(value: string): string {
  if (!value.trim()) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function statusBadgeClass(status: string): string {
  const token = status.toUpperCase();
  if (token === "TRANSFERRED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (token === "TRANSFER_REQUESTED") return "bg-amber-50 text-amber-800 border-amber-200";
  if (token === "ENROLLED") return "bg-blue-50 text-blue-700 border-blue-200";
  if (token === "ENROLLED_PARTIAL") return "bg-orange-50 text-orange-700 border-orange-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

export function StudentClearancePage({
  appTitle,
  nav,
  activeHref,
  roleContext,
}: StudentClearancePageProps) {
  const [rows, setRows] = useState<StudentClearanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowFilter>("all");
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);

  const [actionTarget, setActionTarget] = useState<StudentClearanceRow | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [actioning, setActioning] = useState(false);

  const canRequest = roleContext === "secretary";
  const actionLabel = canRequest ? "Transfer request" : "Transfer approval";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("workflow", workflow);
      params.set("limit", String(PAGE_SIZE + 1));
      params.set("offset", String((page - 1) * PAGE_SIZE));
      const trimmedSearch = query.trim();
      if (trimmedSearch) params.set("search", trimmedSearch);

      const raw = await api.get<unknown>(`/tenants/students/clearance?${params.toString()}`, {
        tenantRequired: true,
        noRedirect: true,
      });
      const normalized = normalizeStudentClearanceRows(raw);
      setHasNextPage(normalized.length > PAGE_SIZE);
      setRows(normalized.slice(0, PAGE_SIZE));
    } catch (error: unknown) {
      setRows([]);
      setHasNextPage(false);
      const message = error instanceof Error ? error.message : "Unable to load student clearance rows.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, query, workflow]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [query, workflow]);

  const readyCount = useMemo(() => {
    if (canRequest) {
      return rows.filter((row) => row.ready_for_transfer_request && !row.transfer_requested).length;
    }
    return rows.filter((row) => row.ready_for_director_approval && !row.transfer_approved).length;
  }, [canRequest, rows]);

  const pendingCount = useMemo(
    () => rows.filter((row) => row.transfer_requested && !row.transfer_approved).length,
    [rows]
  );

  const approvedCount = useMemo(
    () => rows.filter((row) => row.transfer_approved).length,
    [rows]
  );

  const submitAction = useCallback(async () => {
    if (!actionTarget) return;

    setActioning(true);
    try {
      const endpoint = canRequest
        ? `/tenants/students/clearance/${encodeURIComponent(actionTarget.enrollment_id)}/transfer/request`
        : `/tenants/students/clearance/${encodeURIComponent(actionTarget.enrollment_id)}/transfer/approve`;

      const body = canRequest
        ? { reason: actionNote.trim() || undefined }
        : { note: actionNote.trim() || undefined };

      await api.post(endpoint, body, {
        tenantRequired: true,
        noRedirect: true,
      });

      toast.success(
        canRequest
          ? "Transfer request submitted for director approval."
          : "Transfer approved. Secretary will receive a notification with transfer identifiers."
      );
      setActionTarget(null);
      setActionNote("");
      await load();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `Unable to complete ${actionLabel.toLowerCase()}.`;
      toast.error(message);
    } finally {
      setActioning(false);
    }
  }, [actionLabel, actionNote, actionTarget, canRequest, load]);

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Students · Clearance</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                {canRequest
                  ? "Validate fees and school assets before raising a transfer request."
                  : "Approve transfer requests only after all clearance blockers are resolved."}
              </p>
            </div>
            <Button
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Rows Loaded</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{rows.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Ready Actions</div>
            <div className="mt-1 text-2xl font-bold text-blue-700">{readyCount}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Pending Approval</div>
            <div className="mt-1 text-2xl font-bold text-amber-700">{pendingCount}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Approved</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{approvedCount}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Clearance Register</h2>
              <span className="text-xs text-slate-500">Page {page}</span>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-8"
                  placeholder="Search student, ADM, class, term, NEMIS, assessment"
                />
              </div>

              <Select value={workflow} onValueChange={(value) => setWorkflow(value as WorkflowFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Workflow" />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1 || loading}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPage((prev) => prev + 1)}
                  disabled={!hasNextPage || loading}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto px-2 pb-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Class / Term</TableHead>
                  <TableHead>Identifiers</TableHead>
                  <TableHead>Fees</TableHead>
                  <TableHead>Assets</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Blockers</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const canTakeAction = canRequest
                    ? row.ready_for_transfer_request && !row.transfer_requested && !row.transfer_approved
                    : row.ready_for_director_approval && row.transfer_requested && !row.transfer_approved;

                  return (
                    <TableRow key={row.enrollment_id}>
                      <TableCell className="min-w-[220px]">
                        <div className="font-medium text-slate-900">{row.student_name}</div>
                        <div className="text-xs text-slate-500">
                          ADM: {row.admission_number} · ID: {row.enrollment_id.slice(0, 8)}...
                        </div>
                        {row.grade9_candidate ? (
                          <Badge
                            variant="outline"
                            className="mt-1 border-purple-200 bg-purple-50 text-purple-700"
                          >
                            Grade 9 Candidate
                          </Badge>
                        ) : null}
                      </TableCell>

                      <TableCell className="min-w-[140px]">
                        <div className="font-medium text-slate-900">{row.class_code}</div>
                        <div className="text-xs text-slate-500">{row.term_code}</div>
                      </TableCell>

                      <TableCell className="min-w-[170px]">
                        <div className="text-xs text-slate-600">NEMIS: {row.nemis_no}</div>
                        <div className="text-xs text-slate-600">Assessment: {row.assessment_no}</div>
                      </TableCell>

                      <TableCell className="min-w-[150px]">
                        <Badge
                          variant="outline"
                          className={
                            row.fees_cleared
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-red-200 bg-red-50 text-red-700"
                          }
                        >
                          {row.fees_cleared ? "Cleared" : row.fees_status}
                        </Badge>
                        <div className="mt-1 text-xs text-slate-600">
                          Balance: {formatKes(row.fees_balance)}
                        </div>
                      </TableCell>

                      <TableCell className="min-w-[130px]">
                        <Badge
                          variant="outline"
                          className={
                            row.assets_cleared
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-red-200 bg-red-50 text-red-700"
                          }
                        >
                          {row.assets_cleared
                            ? "All Returned"
                            : `${row.outstanding_assets} Outstanding`}
                        </Badge>
                      </TableCell>

                      <TableCell className="min-w-[180px] space-y-1">
                        <Badge variant="outline" className={statusBadgeClass(row.status)}>
                          {row.status}
                        </Badge>
                        {row.transfer_requested_at ? (
                          <div className="text-[11px] text-slate-500">
                            Requested: {formatIsoDateTime(row.transfer_requested_at)}
                          </div>
                        ) : null}
                        {row.transfer_approved_at ? (
                          <div className="text-[11px] text-slate-500">
                            Approved: {formatIsoDateTime(row.transfer_approved_at)}
                          </div>
                        ) : null}
                      </TableCell>

                      <TableCell className="min-w-[220px]">
                        {row.blockers.length > 0 ? (
                          <ul className="space-y-1 text-xs text-red-700">
                            {row.blockers.map((blocker) => (
                              <li key={`${row.enrollment_id}-${blocker}`}>• {blocker}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-emerald-700">No blockers</span>
                        )}
                      </TableCell>

                      <TableCell className="min-w-[180px] text-right">
                        {row.transfer_approved ? (
                          <Badge className="bg-emerald-600 text-white">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Approved
                          </Badge>
                        ) : canTakeAction ? (
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700"
                            onClick={() => {
                              setActionTarget(row);
                              setActionNote("");
                            }}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {canRequest ? "Request Transfer" : "Approve Transfer"}
                          </Button>
                        ) : row.transfer_requested ? (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-700"
                          >
                            Awaiting Director
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-slate-50 text-slate-600"
                          >
                            Blocked
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {!loading && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-20 text-center text-sm text-slate-500">
                      No students found for current clearance filters.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(actionTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setActionTarget(null);
            setActionNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionLabel}</DialogTitle>
            <DialogDescription>
              {actionTarget
                ? `${actionTarget.student_name} (${actionTarget.admission_number})`
                : "No student selected."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              {canRequest
                ? "Optional reason for transfer request (visible in audit history)."
                : "Optional approval note for handover and document preparation."}
            </p>
            <Textarea
              value={actionNote}
              onChange={(event) => setActionNote(event.target.value)}
              placeholder={canRequest ? "Transfer request reason..." : "Approval note..."}
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setActionTarget(null);
                setActionNote("");
              }}
              disabled={actioning}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitAction()} disabled={actioning}>
              {actioning ? "Submitting..." : actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
