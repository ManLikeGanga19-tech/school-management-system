"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  normalizeAssetAssignments,
  normalizeAssets,
  normalizeClassOptions,
  normalizeEnrollmentOptions,
  normalizeStaff,
  type AssetAssignment,
  type EnrollmentOption,
  type TenantClassOption,
  type TenantAsset,
  type TenantStaff,
} from "@/lib/hr";

type SchoolAssetsPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
};

type AssetForm = {
  asset_code: string;
  name: string;
  category: string;
  description: string;
  condition_status: string;
  is_active: boolean;
};

type AssetAssignmentForm = {
  asset_id: string;
  assignee_type: "STAFF" | "CLASS" | "STUDENT";
  staff_id: string;
  class_code: string;
  enrollment_id: string;
  due_at: string;
  notes: string;
};

const initialAssetForm: AssetForm = {
  asset_code: "",
  name: "",
  category: "",
  description: "",
  condition_status: "AVAILABLE",
  is_active: true,
};

const initialAssignmentForm: AssetAssignmentForm = {
  asset_id: "",
  assignee_type: "STAFF",
  staff_id: "",
  class_code: "",
  enrollment_id: "",
  due_at: "",
  notes: "",
};

export function SchoolAssetsPage({ appTitle, nav, activeHref }: SchoolAssetsPageProps) {
  const [assets, setAssets] = useState<TenantAsset[]>([]);
  const [assignments, setAssignments] = useState<AssetAssignment[]>([]);
  const [staff, setStaff] = useState<TenantStaff[]>([]);
  const [classes, setClasses] = useState<TenantClassOption[]>([]);
  const [students, setStudents] = useState<EnrollmentOption[]>([]);

  const [assetForm, setAssetForm] = useState<AssetForm>(initialAssetForm);
  const [assignmentForm, setAssignmentForm] = useState<AssetAssignmentForm>(initialAssignmentForm);

  const [loading, setLoading] = useState(true);
  const [savingAsset, setSavingAsset] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);

  const [assetQuery, setAssetQuery] = useState("");
  const [assetStatusFilter, setAssetStatusFilter] = useState("__all__");
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState("__all__");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [assetsRaw, assignmentsRaw, staffRaw, classesRaw, enrollmentsRaw] = await Promise.all([
        api.get<unknown>("/tenants/hr/assets?include_inactive=true&limit=500", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/tenants/hr/asset-assignments?limit=500", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/tenants/hr/staff?include_inactive=false&limit=500", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/tenants/classes?include_inactive=false", {
          tenantRequired: true,
          noRedirect: true,
        }),
        api.get<unknown>("/enrollments/", {
          tenantRequired: true,
          noRedirect: true,
        }),
      ]);

      setAssets(normalizeAssets(assetsRaw));
      setAssignments(normalizeAssetAssignments(assignmentsRaw));
      setStaff(normalizeStaff(staffRaw));
      setClasses(normalizeClassOptions(classesRaw));
      setStudents(
        normalizeEnrollmentOptions(enrollmentsRaw).filter((row) =>
          ["APPROVED", "ENROLLED", "ENROLLED_PARTIAL", "SUBMITTED"].includes(row.status)
        )
      );
    } catch (err: any) {
      setAssets([]);
      setAssignments([]);
      setStaff([]);
      setClasses([]);
      setStudents([]);
      toast.error(typeof err?.message === "string" ? err.message : "Failed to load HR assets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    return assets.filter((row) => {
      const searchMatch =
        !q ||
        row.asset_code.toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q) ||
        row.category.toLowerCase().includes(q) ||
        (row.description || "").toLowerCase().includes(q);

      const statusMatch =
        assetStatusFilter === "__all__" ||
        (assetStatusFilter === "ACTIVE" ? row.is_active : !row.is_active);

      return searchMatch && statusMatch;
    });
  }, [assetQuery, assetStatusFilter, assets]);

  const filteredAssignments = useMemo(() => {
    const q = assignmentQuery.trim().toLowerCase();
    return assignments.filter((row) => {
      const assigneeLabel =
        row.assignee_type === "CLASS"
          ? row.class_code || "Class assignment"
          : row.assignee_type === "STUDENT"
            ? row.student_name || "Student assignment"
            : row.staff_name || "Staff assignment";

      const searchMatch =
        !q ||
        row.asset_code.toLowerCase().includes(q) ||
        row.asset_name.toLowerCase().includes(q) ||
        assigneeLabel.toLowerCase().includes(q) ||
        (row.staff_no || "").toLowerCase().includes(q) ||
        (row.student_name || "").toLowerCase().includes(q) ||
        (row.class_code || "").toLowerCase().includes(q);

      const statusMatch =
        assignmentStatusFilter === "__all__" || row.status === assignmentStatusFilter;

      return searchMatch && statusMatch;
    });
  }, [assignmentQuery, assignmentStatusFilter, assignments]);

  const assignableAssets = useMemo(() => {
    return assets.filter((row) => row.is_active);
  }, [assets]);

  function toApiDateTime(localDateTime: string): string | null {
    const cleaned = localDateTime.trim();
    if (!cleaned) return null;
    const parsed = new Date(cleaned);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  function formatDateTime(value: string | null): string {
    if (!value) return "N/A";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
  }

  function assignmentAssigneeLabel(row: AssetAssignment): string {
    if (row.assignee_type === "CLASS") return row.class_code || "Class assignment";
    if (row.assignee_type === "STUDENT") return row.student_name || "Student assignment";
    return row.staff_name || "Staff assignment";
  }

  async function createAsset() {
    const assetCode = assetForm.asset_code.trim().toUpperCase();
    const name = assetForm.name.trim();
    const category = assetForm.category.trim();
    if (!assetCode || !name || !category) {
      toast.error("Asset code, name, and category are required.");
      return;
    }

    setSavingAsset(true);
    try {
      await api.post(
        "/tenants/hr/assets",
        {
          asset_code: assetCode,
          name,
          category,
          description: assetForm.description.trim() || null,
          condition_status: assetForm.condition_status.trim().toUpperCase() || "AVAILABLE",
          is_active: assetForm.is_active,
        },
        { tenantRequired: true }
      );
      toast.success("Asset registered.");
      setAssetForm(initialAssetForm);
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to register asset");
    } finally {
      setSavingAsset(false);
    }
  }

  async function assignAsset() {
    if (!assignmentForm.asset_id) {
      toast.error("Asset selection is required.");
      return;
    }
    if (assignmentForm.assignee_type === "STAFF" && !assignmentForm.staff_id) {
      toast.error("Staff selection is required.");
      return;
    }
    if (assignmentForm.assignee_type === "CLASS" && !assignmentForm.class_code) {
      toast.error("Class selection is required.");
      return;
    }
    if (assignmentForm.assignee_type === "STUDENT" && !assignmentForm.enrollment_id) {
      toast.error("Student selection is required.");
      return;
    }

    setSavingAssignment(true);
    try {
      await api.post(
        "/tenants/hr/asset-assignments",
        {
          asset_id: assignmentForm.asset_id,
          assignee_type: assignmentForm.assignee_type,
          staff_id: assignmentForm.assignee_type === "STAFF" ? assignmentForm.staff_id : null,
          class_code: assignmentForm.assignee_type === "CLASS" ? assignmentForm.class_code : null,
          enrollment_id:
            assignmentForm.assignee_type === "STUDENT" ? assignmentForm.enrollment_id : null,
          due_at: toApiDateTime(assignmentForm.due_at),
          notes: assignmentForm.notes.trim() || null,
        },
        { tenantRequired: true }
      );
      toast.success("Asset assigned.");
      setAssignmentForm(initialAssignmentForm);
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to assign asset");
    } finally {
      setSavingAssignment(false);
    }
  }

  async function markReturned(row: AssetAssignment) {
    setReturningId(row.id);
    try {
      await api.put(
        `/tenants/hr/asset-assignments/${row.id}/return`,
        { notes: "Returned via HR dashboard" },
        { tenantRequired: true }
      );
      toast.success("Asset return recorded.");
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to update return status");
    } finally {
      setReturningId(null);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">HR · School Assets</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Register school assets and manage assignment lifecycle to staff.
              </p>
            </div>
            <Button
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => void load()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Register Asset</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Add books, laboratory kits, sports gear, or any school asset.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Asset Code *</Label>
                <Input
                  value={assetForm.asset_code}
                  onChange={(e) =>
                    setAssetForm((prev) => ({ ...prev, asset_code: e.target.value }))
                  }
                  placeholder="ASSET-001"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Asset Name *</Label>
                <Input
                  value={assetForm.name}
                  onChange={(e) => setAssetForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Football set"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Category *</Label>
                <Input
                  value={assetForm.category}
                  onChange={(e) =>
                    setAssetForm((prev) => ({ ...prev, category: e.target.value }))
                  }
                  placeholder="Sports / Books / Lab"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Condition Status</Label>
                <Select
                  value={assetForm.condition_status}
                  onValueChange={(value) =>
                    setAssetForm((prev) => ({ ...prev, condition_status: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AVAILABLE">Available</SelectItem>
                    <SelectItem value="IN_USE">In Use</SelectItem>
                    <SelectItem value="NEEDS_REPAIR">Needs Repair</SelectItem>
                    <SelectItem value="RETIRED">Retired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={assetForm.description}
                onChange={(e) =>
                  setAssetForm((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Asset description, serial number, storage location..."
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Record Status</Label>
                <Select
                  value={assetForm.is_active ? "ACTIVE" : "INACTIVE"}
                  onValueChange={(value) =>
                    setAssetForm((prev) => ({ ...prev, is_active: value === "ACTIVE" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-4">
              <Button onClick={() => void createAsset()} disabled={savingAsset}>
                {savingAsset ? "Saving..." : "Register Asset"}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Assign Asset</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Assign an asset to staff, class, or student and track return deadlines.
              </p>
            </div>

            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Asset *</Label>
                <Select
                  value={assignmentForm.asset_id || "__none__"}
                  onValueChange={(value) =>
                    setAssignmentForm((prev) => ({
                      ...prev,
                      asset_id: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select asset" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select asset</SelectItem>
                    {assignableAssets.map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>
                        {asset.asset_code} · {asset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Assignee Type *</Label>
                <Select
                  value={assignmentForm.assignee_type}
                  onValueChange={(value) =>
                    setAssignmentForm((prev) => ({
                      ...prev,
                      assignee_type: value as "STAFF" | "CLASS" | "STUDENT",
                      staff_id: "",
                      class_code: "",
                      enrollment_id: "",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STAFF">Staff</SelectItem>
                    <SelectItem value="CLASS">Class</SelectItem>
                    <SelectItem value="STUDENT">Student</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {assignmentForm.assignee_type === "STAFF" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Staff *</Label>
                  <Select
                    value={assignmentForm.staff_id || "__none__"}
                    onValueChange={(value) =>
                      setAssignmentForm((prev) => ({
                        ...prev,
                        staff_id: value === "__none__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select staff</SelectItem>
                      {staff.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.full_name} ({row.staff_no})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {assignmentForm.assignee_type === "CLASS" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Class *</Label>
                  <Select
                    value={assignmentForm.class_code || "__none__"}
                    onValueChange={(value) =>
                      setAssignmentForm((prev) => ({
                        ...prev,
                        class_code: value === "__none__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select class" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select class</SelectItem>
                      {classes.map((classRow) => (
                        <SelectItem key={classRow.id} value={classRow.code}>
                          {classRow.code} · {classRow.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {assignmentForm.assignee_type === "STUDENT" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Student *</Label>
                  <Select
                    value={assignmentForm.enrollment_id || "__none__"}
                    onValueChange={(value) =>
                      setAssignmentForm((prev) => ({
                        ...prev,
                        enrollment_id: value === "__none__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select student enrollment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select student</SelectItem>
                      {students.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.student_name}
                          {row.admission_number ? ` (${row.admission_number})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Return Due Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={assignmentForm.due_at}
                  onChange={(e) =>
                    setAssignmentForm((prev) => ({ ...prev, due_at: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Assignment Notes</Label>
                <Textarea
                  value={assignmentForm.notes}
                  onChange={(e) =>
                    setAssignmentForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="Reason for assignment or expected return date"
                />
              </div>
            </div>

            <div className="mt-4">
              <Button onClick={() => void assignAsset()} disabled={savingAssignment}>
                {savingAssignment ? "Saving..." : "Assign Asset"}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Asset Register</h2>
              <span className="text-xs text-slate-500">Total: {filteredAssets.length}</span>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                  className="pl-8"
                  placeholder="Search by asset code, name, category"
                />
              </div>

              <Select value={assetStatusFilter} onValueChange={setAssetStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Code</TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-xs">Condition</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                filteredAssets.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs text-slate-700">{row.asset_code}</TableCell>
                    <TableCell className="text-xs font-medium text-slate-900">{row.name}</TableCell>
                    <TableCell className="text-xs text-slate-700">{row.category}</TableCell>
                    <TableCell className="text-xs text-slate-700">{row.condition_status}</TableCell>
                    <TableCell>
                      <span
                        className={
                          row.is_active
                            ? "text-xs font-medium text-emerald-700"
                            : "text-xs font-medium text-slate-500"
                        }
                      >
                        {row.is_active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && filteredAssets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">
                    No assets found.
                  </TableCell>
                </TableRow>
              )}

              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">
                    Loading assets...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Asset Assignment Log</h2>
              <span className="text-xs text-slate-500">Total: {filteredAssignments.length}</span>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={assignmentQuery}
                  onChange={(e) => setAssignmentQuery(e.target.value)}
                  className="pl-8"
                  placeholder="Search by asset, assignee, class, or student"
                />
              </div>

              <Select
                value={assignmentStatusFilter}
                onValueChange={setAssignmentStatusFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="ASSIGNED">Assigned</SelectItem>
                  <SelectItem value="RETURNED">Returned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs">Asset</TableHead>
                <TableHead className="text-xs">Assignee</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Due At</TableHead>
                <TableHead className="text-xs">Assigned At</TableHead>
                <TableHead className="text-xs">Returned At</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                filteredAssignments.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-slate-700">
                      <div className="font-medium text-slate-900">{row.asset_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{row.asset_code}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{assignmentAssigneeLabel(row)}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {row.assignee_type === "STAFF"
                          ? row.staff_no || "STAFF"
                          : row.assignee_type === "CLASS"
                            ? row.class_code || "CLASS"
                            : row.enrollment_id || "STUDENT"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          row.status === "RETURNED"
                            ? "text-xs font-medium text-slate-600"
                            : "text-xs font-medium text-amber-700"
                        }
                      >
                        {row.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{formatDateTime(row.due_at)}</div>
                      {row.is_overdue && row.status === "ASSIGNED" && (
                        <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                          Overdue
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      {formatDateTime(row.assigned_at)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      {formatDateTime(row.returned_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === "ASSIGNED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void markReturned(row)}
                          disabled={returningId === row.id}
                        >
                          {returningId === row.id ? "Saving..." : "Mark Returned"}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-500">Completed</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && filteredAssignments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    No asset assignments found.
                  </TableCell>
                </TableRow>
              )}

              {loading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    Loading asset assignments...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppShell>
  );
}
