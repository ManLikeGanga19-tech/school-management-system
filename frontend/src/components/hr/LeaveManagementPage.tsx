"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarOff,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { normalizeStaff, type TenantStaff } from "@/lib/hr";
import { asArray } from "@/lib/utils/asArray";

// ── Types ─────────────────────────────────────────────────────────────────────

type LeaveRequest = {
  id: string;
  staff_id: string;
  staff_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function normalizeLeave(raw: unknown): LeaveRequest[] {
  return asArray<unknown>(raw).flatMap((r) => {
    const o = asObj(r);
    if (!o?.id) return [];
    return [
      {
        id: asStr(o.id),
        staff_id: asStr(o.staff_id),
        staff_name: asStr(o.staff_name) || "Unknown",
        leave_type: asStr(o.leave_type),
        start_date: asStr(o.start_date),
        end_date: asStr(o.end_date),
        days_requested: Number(o.days_requested ?? 0),
        reason: (o.reason as string) ?? null,
        status: asStr(o.status),
        reviewed_by: (o.reviewed_by as string) ?? null,
        reviewed_at: (o.reviewed_at as string) ?? null,
        review_note: (o.review_note as string) ?? null,
        created_at: (o.created_at as string) ?? null,
      },
    ];
  });
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusBadge(status: string) {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return "bg-green-100 text-green-800";
    case "REJECTED":
      return "bg-red-100 text-red-800";
    case "CANCELLED":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-yellow-100 text-yellow-800";
  }
}

const LEAVE_TYPES = ["ANNUAL", "SICK", "MATERNITY", "PATERNITY", "UNPAID", "OTHER"];
const STATUS_FILTERS = ["", "PENDING", "APPROVED", "REJECTED", "CANCELLED"];

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  canApprove?: boolean;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function LeaveManagementPage({ appTitle, nav, activeHref, canApprove = false }: Props) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [staff, setStaff] = useState<TenantStaff[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    staff_id: "",
    leave_type: "ANNUAL",
    start_date: "",
    end_date: "",
    reason: "",
  });

  // Review dialog
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<LeaveRequest | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [reviewNote, setReviewNote] = useState("");

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchLeave = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (staffFilter) params.set("staff_id", staffFilter);
      const res = await api.get<unknown>(
        `/tenants/hr/leave${params.toString() ? `?${params}` : ""}`,
        { tenantRequired: true }
      );
      setRequests(normalizeLeave(res));
    } catch {
      toast.error("Failed to load leave requests");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, staffFilter]);

  const fetchStaff = useCallback(async () => {
    try {
      const res = await api.get<unknown>("/tenants/hr/staff?limit=500", {
        tenantRequired: true,
      });
      setStaff(normalizeStaff(res));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchLeave();
    fetchStaff();
  }, [fetchLeave, fetchStaff]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.staff_id || !form.start_date || !form.end_date) return;
    setCreating(true);
    try {
      await api.post<unknown>(
        "/tenants/hr/leave",
        {
          staff_id: form.staff_id,
          leave_type: form.leave_type,
          start_date: form.start_date,
          end_date: form.end_date,
          reason: form.reason || undefined,
        },
        { tenantRequired: true }
      );
      toast.success("Leave request submitted");
      setCreateOpen(false);
      setForm({ staff_id: "", leave_type: "ANNUAL", start_date: "", end_date: "", reason: "" });
      fetchLeave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit leave request");
    } finally {
      setCreating(false);
    }
  }

  function openReview(req: LeaveRequest) {
    setReviewTarget(req);
    setReviewStatus("APPROVED");
    setReviewNote("");
    setReviewOpen(true);
  }

  async function handleReview(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewTarget) return;
    setReviewing(true);
    try {
      await api.patch<unknown>(
        `/tenants/hr/leave/${reviewTarget.id}/review`,
        { status: reviewStatus, review_note: reviewNote || undefined },
        { tenantRequired: true }
      );
      toast.success(`Leave request ${reviewStatus.toLowerCase()}`);
      setReviewOpen(false);
      fetchLeave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    } finally {
      setReviewing(false);
    }
  }

  async function handleCancel(req: LeaveRequest) {
    if (!confirm(`Cancel leave request for ${req.staff_name}?`)) return;
    try {
      await api.patch<unknown>(
        `/tenants/hr/leave/${req.id}/cancel`,
        {},
        { tenantRequired: true }
      );
      toast.success("Leave request cancelled");
      fetchLeave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppShell nav={nav} title={`${appTitle} — Leave Management`} activeHref={activeHref}>
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarOff className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Leave Management</h1>
              <p className="text-sm text-gray-500">Track and manage staff leave requests</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={fetchLeave} className="gap-1">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> New Request
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s || "All statuses"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="All staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All staff</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-lg border bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : requests.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">No leave requests found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Staff</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left">Period</th>
                    <th className="px-4 py-2 text-center">Days</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Note</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {requests.map((req) => (
                    <tr key={req.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{req.staff_name}</td>
                      <td className="px-4 py-2 text-gray-600">{req.leave_type}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                        {fmtDate(req.start_date)} – {fmtDate(req.end_date)}
                      </td>
                      <td className="px-4 py-2 text-center font-medium">{req.days_requested}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(req.status)}`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-2 truncate text-gray-500">
                        {req.review_note ?? req.reason ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {canApprove && req.status === "PENDING" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() => openReview(req)}
                            >
                              <CheckCircle2 className="h-3 w-3" /> Review
                            </Button>
                          )}
                          {req.status === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs text-red-600 hover:text-red-700"
                              onClick={() => handleCancel(req)}
                            >
                              <XCircle className="h-3 w-3" /> Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Leave Request</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <Label>Staff Member</Label>
              <Select
                value={form.staff_id}
                onValueChange={(v) => setForm((f) => ({ ...f, staff_id: v }))}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select staff…" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name} ({s.staff_no})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Leave Type</Label>
              <Select
                value={form.leave_type}
                onValueChange={(v) => setForm((f) => ({ ...f, leave_type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div>
              <Label>Reason (optional)</Label>
              <Textarea
                rows={3}
                placeholder="Brief description…"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Leave Request</DialogTitle>
          </DialogHeader>
          {reviewTarget && (
            <div className="mb-3 rounded-md bg-gray-50 px-4 py-3 text-sm">
              <p>
                <span className="text-gray-500">Staff:</span>{" "}
                <span className="font-medium">{reviewTarget.staff_name}</span>
              </p>
              <p>
                <span className="text-gray-500">Type:</span> {reviewTarget.leave_type}
              </p>
              <p>
                <span className="text-gray-500">Period:</span>{" "}
                {fmtDate(reviewTarget.start_date)} – {fmtDate(reviewTarget.end_date)} (
                {reviewTarget.days_requested} days)
              </p>
              {reviewTarget.reason && (
                <p>
                  <span className="text-gray-500">Reason:</span> {reviewTarget.reason}
                </p>
              )}
            </div>
          )}
          <form onSubmit={handleReview} className="space-y-4">
            <div>
              <Label>Decision</Label>
              <Select
                value={reviewStatus}
                onValueChange={(v) => setReviewStatus(v as "APPROVED" | "REJECTED")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVED">Approve</SelectItem>
                  <SelectItem value="REJECTED">Reject</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea
                rows={3}
                placeholder="Add a note for the staff member…"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={reviewing}
                variant={reviewStatus === "REJECTED" ? "destructive" : "default"}
              >
                {reviewing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : reviewStatus === "APPROVED" ? (
                  "Approve"
                ) : (
                  "Reject"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
