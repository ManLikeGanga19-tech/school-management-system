"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, PencilLine, RefreshCw, Search } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
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
  normalizeStaff,
  normalizeSubjects,
  type TenantStaff,
  type TenantSubject,
} from "@/lib/hr";

type TenantRoleOption = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
};

type StaffRegistryPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  allowCreate?: boolean;
  directorView?: boolean;
};

type StaffCreateForm = {
  staff_no: string;
  staff_type: "TEACHING" | "NON_TEACHING";
  role_code: string;
  primary_subject_id: string;
  employment_type: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  id_number: string;
  tsc_number: string;
  kra_pin: string;
  nssf_number: string;
  nhif_number: string;
  gender: string;
  date_of_birth: string;
  date_hired: string;
  next_of_kin_name: string;
  next_of_kin_relation: string;
  next_of_kin_phone: string;
  next_of_kin_email: string;
  address: string;
  notes: string;
  is_active: boolean;
};

type StaffEditForm = StaffCreateForm & {
  separation_status: string;
  separation_reason: string;
  separation_date: string;
};

const initialForm: StaffCreateForm = {
  staff_no: "",
  staff_type: "TEACHING",
  role_code: "",
  primary_subject_id: "",
  employment_type: "",
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  id_number: "",
  tsc_number: "",
  kra_pin: "",
  nssf_number: "",
  nhif_number: "",
  gender: "",
  date_of_birth: "",
  date_hired: "",
  next_of_kin_name: "",
  next_of_kin_relation: "",
  next_of_kin_phone: "",
  next_of_kin_email: "",
  address: "",
  notes: "",
  is_active: true,
};

const initialEditForm: StaffEditForm = {
  ...initialForm,
  separation_status: "__none__",
  separation_reason: "",
  separation_date: "",
};

function toEditForm(row: TenantStaff): StaffEditForm {
  return {
    staff_no: row.staff_no || "",
    staff_type: row.staff_type === "NON_TEACHING" ? "NON_TEACHING" : "TEACHING",
    role_code: row.role_code || "",
    primary_subject_id: row.primary_subject_id || "",
    employment_type: row.employment_type || "",
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    email: row.email || "",
    phone: row.phone || "",
    id_number: row.id_number || "",
    tsc_number: row.tsc_number || "",
    kra_pin: row.kra_pin || "",
    nssf_number: row.nssf_number || "",
    nhif_number: row.nhif_number || "",
    gender: row.gender || "",
    date_of_birth: row.date_of_birth || "",
    date_hired: row.date_hired || "",
    next_of_kin_name: row.next_of_kin_name || "",
    next_of_kin_relation: row.next_of_kin_relation || "",
    next_of_kin_phone: row.next_of_kin_phone || "",
    next_of_kin_email: row.next_of_kin_email || "",
    address: row.address || "",
    notes: row.notes || "",
    is_active: row.is_active,
    separation_status: row.separation_status || "__none__",
    separation_reason: row.separation_reason || "",
    separation_date: row.separation_date || "",
  };
}

function normalizeRolesPayload(input: unknown): TenantRoleOption[] {
  const rawRows: unknown[] = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as any).roles)
      ? (input as any).roles
      : [];

  return rawRows
    .map((raw: unknown): TenantRoleOption | null => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      if (!row) return null;

      const id = typeof row.id === "string" ? row.id.trim() : "";
      const code = typeof row.code === "string" ? row.code.trim().toUpperCase() : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!id || !code || !name) return null;
      if (code === "SUPER_ADMIN") return null;

      const description =
        typeof row.description === "string" && row.description.trim().length > 0
          ? row.description.trim()
          : null;

      return { id, code, name, description };
    })
    .filter((row: TenantRoleOption | null): row is TenantRoleOption => Boolean(row))
    .sort((a: TenantRoleOption, b: TenantRoleOption) => a.code.localeCompare(b.code));
}

function roleDisplay(roles: TenantRoleOption[], roleCode: string | null | undefined): string {
  const code = (roleCode || "").trim().toUpperCase();
  if (!code) return "Not assigned";
  if (code === "SUPER_ADMIN") return "Restricted role";
  const role = roles.find((item) => item.code === code);
  return role ? `${role.name} (${role.code})` : code;
}

function subjectDisplay(row: TenantStaff): string {
  if (!row.primary_subject_id) return "Not set";
  const code = (row.primary_subject_code || "").trim().toUpperCase();
  const name = (row.primary_subject_name || "").trim();
  if (code && name) return `${code} · ${name}`;
  if (code) return code;
  if (name) return name;
  return "Not set";
}

export function StaffRegistryPage({
  appTitle,
  nav,
  activeHref,
  allowCreate = true,
  directorView,
}: StaffRegistryPageProps) {
  const isDirectorView = directorView ?? allowCreate;

  const [rows, setRows] = useState<TenantStaff[]>([]);
  const [roles, setRoles] = useState<TenantRoleOption[]>([]);
  const [subjects, setSubjects] = useState<TenantSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);

  const [form, setForm] = useState<StaffCreateForm>(initialForm);
  const [editForm, setEditForm] = useState<StaffEditForm>(initialEditForm);
  const [selectedRow, setSelectedRow] = useState<TenantStaff | null>(null);
  const [editingRow, setEditingRow] = useState<TenantStaff | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [staffTypeFilter, setStaffTypeFilter] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("__all__");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const includeInactive = isDirectorView ? "true" : "false";
      const includeSeparated = isDirectorView ? "true" : "false";
      const staffPromise = api.get<unknown>(
        `/tenants/hr/staff?include_inactive=${includeInactive}&include_separated=${includeSeparated}&limit=500`,
        {
          tenantRequired: true,
          noRedirect: true,
        }
      );
      const rolesPromise =
        allowCreate || isDirectorView
          ? api
              .get<unknown>("/tenants/director/roles", {
                tenantRequired: true,
                noRedirect: true,
              })
              .catch(() => [])
          : Promise.resolve<unknown>([]);
      const subjectsPromise = api
        .get<unknown>("/tenants/subjects?include_inactive=false", {
          tenantRequired: true,
          noRedirect: true,
        })
        .catch(() => []);

      const [staffData, rolesData, subjectsData] = await Promise.all([
        staffPromise,
        rolesPromise,
        subjectsPromise,
      ]);
      setRows(normalizeStaff(staffData));
      setRoles(normalizeRolesPayload(rolesData));
      setSubjects(normalizeSubjects(subjectsData));
    } catch (err: any) {
      setRows([]);
      setRoles([]);
      setSubjects([]);
      toast.error(typeof err?.message === "string" ? err.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, [allowCreate, isDirectorView]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const searchMatch =
        !q ||
        row.full_name.toLowerCase().includes(q) ||
        row.staff_no.toLowerCase().includes(q) ||
        row.email?.toLowerCase().includes(q) ||
        row.phone?.toLowerCase().includes(q) ||
        row.tsc_number?.toLowerCase().includes(q);

      const typeMatch = staffTypeFilter === "__all__" || row.staff_type === staffTypeFilter;
      const statusMatch =
        statusFilter === "__all__" ||
        (statusFilter === "ACTIVE" ? row.is_active : !row.is_active);

      return searchMatch && typeMatch && statusMatch;
    });
  }, [query, rows, staffTypeFilter, statusFilter]);

  async function createStaff() {
    const firstName = form.first_name.trim();
    const lastName = form.last_name.trim();
    if (!firstName || !lastName) {
      toast.error("First name and last name are required.");
      return;
    }
    if (form.staff_type === "TEACHING" && !form.tsc_number.trim()) {
      toast.error("TSC number is required for teaching staff.");
      return;
    }

    setSaving(true);
    try {
      await api.post(
        "/tenants/hr/staff",
        {
          staff_no: form.staff_no.trim() || null,
          staff_type: form.staff_type,
          role_code: form.role_code.trim() || null,
          primary_subject_id:
            form.staff_type === "TEACHING" ? form.primary_subject_id.trim() || null : null,
          employment_type: form.employment_type.trim() || null,
          first_name: firstName,
          last_name: lastName,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          id_number: form.id_number.trim() || null,
          tsc_number: form.tsc_number.trim() || null,
          kra_pin: form.kra_pin.trim() || null,
          nssf_number: form.nssf_number.trim() || null,
          nhif_number: form.nhif_number.trim() || null,
          gender: form.gender.trim() || null,
          date_of_birth: form.date_of_birth || null,
          date_hired: form.date_hired || null,
          next_of_kin_name: form.next_of_kin_name.trim() || null,
          next_of_kin_relation: form.next_of_kin_relation.trim() || null,
          next_of_kin_phone: form.next_of_kin_phone.trim() || null,
          next_of_kin_email: form.next_of_kin_email.trim() || null,
          address: form.address.trim() || null,
          notes: form.notes.trim() || null,
          is_active: form.is_active,
        },
        { tenantRequired: true }
      );
      toast.success("Staff record created.");
      setForm(initialForm);
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to create staff");
    } finally {
      setSaving(false);
    }
  }

  function openView(row: TenantStaff) {
    setSelectedRow(row);
    setViewOpen(true);
  }

  function openEdit(row: TenantStaff) {
    setEditingRow(row);
    setEditForm(toEditForm(row));
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editingRow) return;

    const firstName = editForm.first_name.trim();
    const lastName = editForm.last_name.trim();
    if (!firstName || !lastName) {
      toast.error("First name and last name are required.");
      return;
    }
    if (editForm.staff_type === "TEACHING" && !editForm.tsc_number.trim()) {
      toast.error("TSC number is required for teaching staff.");
      return;
    }
    if (
      isDirectorView &&
      editForm.separation_status === "FIRED_MISCONDUCT" &&
      !editForm.separation_reason.trim()
    ) {
      toast.error("Reason is required for fired misconduct status.");
      return;
    }

    setUpdating(true);
    try {
      const payload: Record<string, unknown> = {
        staff_no: editForm.staff_no.trim() || null,
        staff_type: editForm.staff_type,
        role_code: editForm.role_code.trim() || null,
        primary_subject_id:
          editForm.staff_type === "TEACHING" ? editForm.primary_subject_id.trim() || null : null,
        employment_type: editForm.employment_type.trim() || null,
        first_name: firstName,
        last_name: lastName,
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        id_number: editForm.id_number.trim() || null,
        tsc_number: editForm.tsc_number.trim() || null,
        kra_pin: editForm.kra_pin.trim() || null,
        nssf_number: editForm.nssf_number.trim() || null,
        nhif_number: editForm.nhif_number.trim() || null,
        gender: editForm.gender.trim() || null,
        date_of_birth: editForm.date_of_birth || null,
        date_hired: editForm.date_hired || null,
        next_of_kin_name: editForm.next_of_kin_name.trim() || null,
        next_of_kin_relation: editForm.next_of_kin_relation.trim() || null,
        next_of_kin_phone: editForm.next_of_kin_phone.trim() || null,
        next_of_kin_email: editForm.next_of_kin_email.trim() || null,
        address: editForm.address.trim() || null,
        notes: editForm.notes.trim() || null,
        is_active: editForm.is_active,
      };

      if (isDirectorView) {
        payload.separation_status =
          editForm.separation_status === "__none__" ? null : editForm.separation_status;
        payload.separation_reason = editForm.separation_reason.trim() || null;
        payload.separation_date = editForm.separation_date || null;
      }

      await api.put(`/tenants/hr/staff/${editingRow.id}`, payload, {
        tenantRequired: true,
      });

      toast.success("Staff record updated.");
      setEditOpen(false);
      setEditingRow(null);
      await load();
    } catch (err: any) {
      toast.error(typeof err?.message === "string" ? err.message : "Failed to update staff");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <Dialog open={viewOpen} onOpenChange={setViewOpen}>
          <DialogContent className="sm:max-w-[760px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-slate-500" />
                Staff Full Record
              </DialogTitle>
              <DialogDescription>
                {selectedRow ? `Viewing ${selectedRow.full_name}` : "Staff details"}
              </DialogDescription>
            </DialogHeader>
            {selectedRow && (
              <div className="max-h-[68vh] overflow-y-auto space-y-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Full Name</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.full_name}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Staff No</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.staff_no}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Staff Type</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.staff_type}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Role</div>
                    <div className="text-sm font-medium text-slate-900">
                      {roleDisplay(roles, selectedRow.role_code)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Primary Subject</div>
                    <div className="text-sm font-medium text-slate-900">{subjectDisplay(selectedRow)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Employment Type</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.employment_type || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Email</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.email || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Phone</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.phone || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">ID Number</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.id_number || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">TSC Number</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.tsc_number || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">KRA PIN</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.kra_pin || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">NSSF Number</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.nssf_number || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">NHIF Number</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.nhif_number || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Date Hired</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.date_hired || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Next of Kin</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.next_of_kin_name || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Next of Kin Phone</div>
                    <div className="text-sm font-medium text-slate-900">{selectedRow.next_of_kin_phone || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Address</div>
                    <div className="text-sm font-medium text-slate-900 break-words">{selectedRow.address || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Status</div>
                    <div className="text-sm font-medium text-slate-900">
                      {selectedRow.separation_status || (selectedRow.is_active ? "ACTIVE" : "INACTIVE")}
                    </div>
                  </div>
                  {isDirectorView && selectedRow.separation_status && (
                    <>
                      <div>
                        <div className="text-[10px] uppercase text-slate-400">Separation Date</div>
                        <div className="text-sm font-medium text-slate-900">{selectedRow.separation_date || "N/A"}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-slate-400">Separation Reason</div>
                        <div className="text-sm font-medium text-slate-900 break-words">
                          {selectedRow.separation_reason || "N/A"}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-[840px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PencilLine className="h-4 w-4 text-slate-500" />
                Update Staff Record
              </DialogTitle>
              <DialogDescription>
                {editingRow ? `Updating ${editingRow.full_name}` : "Update staff profile"}
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[66vh] overflow-y-auto space-y-3 pr-1">
              <div className="grid gap-3 md:grid-cols-6">
                <div className="space-y-1.5">
                  <Label className="text-xs">Staff No</Label>
                  <Input
                    value={editForm.staff_no}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, staff_no: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Staff Type</Label>
                  <Select
                    value={editForm.staff_type}
                    onValueChange={(value) =>
                      setEditForm((prev) => {
                        const nextType = value === "NON_TEACHING" ? "NON_TEACHING" : "TEACHING";
                        return {
                          ...prev,
                          staff_type: nextType,
                          primary_subject_id:
                            nextType === "TEACHING" ? prev.primary_subject_id : "",
                        };
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TEACHING">Teaching</SelectItem>
                      <SelectItem value="NON_TEACHING">Non-Teaching</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Employment Type</Label>
                  <Input
                    value={editForm.employment_type}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, employment_type: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Role</Label>
                  <Select
                    value={editForm.role_code || "__none__"}
                    onValueChange={(value) =>
                      setEditForm((prev) => ({
                        ...prev,
                        role_code: value === "__none__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not assigned</SelectItem>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.code}>
                          {role.name} ({role.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Primary Subject</Label>
                  <Select
                    value={editForm.primary_subject_id || "__none__"}
                    onValueChange={(value) =>
                      setEditForm((prev) => ({
                        ...prev,
                        primary_subject_id: value === "__none__" ? "" : value,
                      }))
                    }
                    disabled={editForm.staff_type !== "TEACHING"}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          editForm.staff_type === "TEACHING"
                            ? "Select subject"
                            : "Teaching staff only"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not set</SelectItem>
                      {subjects.map((subject) => (
                        <SelectItem key={subject.id} value={subject.id}>
                          {subject.code} · {subject.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Active</Label>
                  <Select
                    value={editForm.is_active ? "ACTIVE" : "INACTIVE"}
                    onValueChange={(value) =>
                      setEditForm((prev) => ({ ...prev, is_active: value === "ACTIVE" }))
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

              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">First Name</Label>
                  <Input
                    value={editForm.first_name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, first_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Last Name</Label>
                  <Input
                    value={editForm.last_name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, last_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input
                    value={editForm.email}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Phone</Label>
                  <Input
                    value={editForm.phone}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-5">
                <div className="space-y-1.5">
                  <Label className="text-xs">ID Number</Label>
                  <Input
                    value={editForm.id_number}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, id_number: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">TSC Number</Label>
                  <Input
                    value={editForm.tsc_number}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, tsc_number: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">KRA PIN</Label>
                  <Input
                    value={editForm.kra_pin}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, kra_pin: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">NSSF Number</Label>
                  <Input
                    value={editForm.nssf_number}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, nssf_number: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">NHIF Number</Label>
                  <Input
                    value={editForm.nhif_number}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, nhif_number: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Date of Birth</Label>
                  <Input
                    type="date"
                    value={editForm.date_of_birth}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, date_of_birth: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date Hired</Label>
                  <Input
                    type="date"
                    value={editForm.date_hired}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, date_hired: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Next of Kin</Label>
                  <Input
                    value={editForm.next_of_kin_name}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, next_of_kin_name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Next of Kin Phone</Label>
                  <Input
                    value={editForm.next_of_kin_phone}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, next_of_kin_phone: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Address</Label>
                  <Textarea
                    value={editForm.address}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Notes</Label>
                  <Textarea
                    value={editForm.notes}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </div>
              </div>

              {isDirectorView && (
                <div className="rounded-xl border border-red-100 bg-red-50 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">
                    Director Separation Controls
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Staff Lifecycle Status</Label>
                      <Select
                        value={editForm.separation_status}
                        onValueChange={(value) =>
                          setEditForm((prev) => ({ ...prev, separation_status: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Active / Employed</SelectItem>
                          <SelectItem value="FIRED_MISCONDUCT">Fired: Misconduct</SelectItem>
                          <SelectItem value="LEFT_PERMANENTLY">Left Permanently</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Separation Date</Label>
                      <Input
                        type="date"
                        value={editForm.separation_date}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, separation_date: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-1">
                      <Label className="text-xs">Reason</Label>
                      <Textarea
                        value={editForm.separation_reason}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, separation_reason: e.target.value }))
                        }
                        placeholder="Required for misconduct"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setEditOpen(false);
                  setEditingRow(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => void saveEdit()} disabled={updating}>
                {updating ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">HR · Staff Registry</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Register and maintain teaching staff records with compliance-grade lifecycle controls.
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

        {allowCreate && (
          <div className="dashboard-surface rounded-[1.6rem] p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Register Staff</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Capture employment profile, statutory IDs, and emergency contact details.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-6">
              <div className="space-y-1.5">
                <Label className="text-xs">Staff Type *</Label>
                <Select
                  value={form.staff_type}
                  onValueChange={(value) =>
                    setForm((prev) => {
                      const nextType = value === "NON_TEACHING" ? "NON_TEACHING" : "TEACHING";
                      return {
                        ...prev,
                        staff_type: nextType,
                        primary_subject_id: nextType === "TEACHING" ? prev.primary_subject_id : "",
                      };
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TEACHING">Teaching</SelectItem>
                    <SelectItem value="NON_TEACHING">Non-Teaching</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Role</Label>
                <Select
                  value={form.role_code || "__none__"}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, role_code: value === "__none__" ? "" : value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not assigned</SelectItem>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.code}>
                        {role.name} ({role.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Primary Subject</Label>
                <Select
                  value={form.primary_subject_id || "__none__"}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      primary_subject_id: value === "__none__" ? "" : value,
                    }))
                  }
                  disabled={form.staff_type !== "TEACHING"}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        form.staff_type === "TEACHING"
                          ? "Select subject"
                          : "Teaching staff only"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    {subjects.map((subject) => (
                      <SelectItem key={subject.id} value={subject.id}>
                        {subject.code} · {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Staff No (optional)</Label>
                <Input
                  value={form.staff_no}
                  onChange={(e) => setForm((prev) => ({ ...prev, staff_no: e.target.value }))}
                  placeholder="Auto-generated if blank"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Employment Type</Label>
                <Select
                  value={form.employment_type || "__none__"}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      employment_type: value === "__none__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    <SelectItem value="FULL_TIME">Full Time</SelectItem>
                    <SelectItem value="PART_TIME">Part Time</SelectItem>
                    <SelectItem value="CONTRACT">Contract</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select
                  value={form.is_active ? "ACTIVE" : "INACTIVE"}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, is_active: value === "ACTIVE" }))
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

            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">First Name *</Label>
                <Input
                  value={form.first_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, first_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Last Name *</Label>
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, last_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-5">
              <div className="space-y-1.5">
                <Label className="text-xs">ID Number</Label>
                <Input
                  value={form.id_number}
                  onChange={(e) => setForm((prev) => ({ ...prev, id_number: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">TSC Number</Label>
                <Input
                  value={form.tsc_number}
                  onChange={(e) => setForm((prev) => ({ ...prev, tsc_number: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">KRA PIN</Label>
                <Input
                  value={form.kra_pin}
                  onChange={(e) => setForm((prev) => ({ ...prev, kra_pin: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">NSSF Number</Label>
                <Input
                  value={form.nssf_number}
                  onChange={(e) => setForm((prev) => ({ ...prev, nssf_number: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">NHIF Number</Label>
                <Input
                  value={form.nhif_number}
                  onChange={(e) => setForm((prev) => ({ ...prev, nhif_number: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Date of Birth</Label>
                <Input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => setForm((prev) => ({ ...prev, date_of_birth: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date Hired</Label>
                <Input
                  type="date"
                  value={form.date_hired}
                  onChange={(e) => setForm((prev) => ({ ...prev, date_hired: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Next of Kin</Label>
                <Input
                  value={form.next_of_kin_name}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, next_of_kin_name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Next of Kin Phone</Label>
                <Input
                  value={form.next_of_kin_phone}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, next_of_kin_phone: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Address</Label>
                <Textarea
                  value={form.address}
                  onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-4">
              <Button onClick={() => void createStaff()} disabled={saving}>
                {saving ? "Saving..." : "Register Staff"}
              </Button>
            </div>
          </div>
        )}

        {!allowCreate && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Staff registration is managed from the Director dashboard. Secretary access on this
            page is read-only for assignment workflows.
          </div>
        )}

        <div className="dashboard-surface rounded-[1.6rem]">
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Staff Directory</h2>
              <span className="text-xs text-slate-500">Total: {filteredRows.length}</span>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8"
                  placeholder="Search by name, staff no, TSC, email"
                />
              </div>

              <Select value={staffTypeFilter} onValueChange={setStaffTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All staff types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All staff types</SelectItem>
                  <SelectItem value="TEACHING">Teaching</SelectItem>
                  <SelectItem value="NON_TEACHING">Non-Teaching</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
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
                <TableHead className="text-xs">Staff</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">TSC/KRA/NSSF</TableHead>
                <TableHead className="text-xs">Contact</TableHead>
                <TableHead className="text-xs">Next of Kin</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading &&
                filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{row.full_name}</div>
                      <div className="text-xs text-slate-500">{row.staff_no}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{row.staff_type}</div>
                      <div className="text-slate-500">Role: {roleDisplay(roles, row.role_code)}</div>
                      <div className="text-slate-500">Subject: {subjectDisplay(row)}</div>
                      <div className="text-slate-500">{row.employment_type || "N/A"}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>TSC: {row.tsc_number || "N/A"}</div>
                      <div>KRA: {row.kra_pin || "N/A"}</div>
                      <div>NSSF: {row.nssf_number || "N/A"}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{row.email || "N/A"}</div>
                      <div>{row.phone || "N/A"}</div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <div>{row.next_of_kin_name || "N/A"}</div>
                      <div>{row.next_of_kin_phone || "N/A"}</div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          row.separation_status
                            ? "text-xs font-semibold text-red-700"
                            : row.is_active
                              ? "text-xs font-medium text-emerald-700"
                              : "text-xs font-medium text-slate-500"
                        }
                      >
                        {row.separation_status || (row.is_active ? "Active" : "Inactive")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => openView(row)}>
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Button>
                        {isDirectorView && (
                          <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                            <PencilLine className="h-3.5 w-3.5" />
                            Update
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    No staff records found.
                  </TableCell>
                </TableRow>
              )}

              {loading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    Loading staff records...
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
