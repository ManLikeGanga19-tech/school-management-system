import { asArray } from "@/lib/utils/asArray";

type UnknownRecord = Record<string, unknown>;

function asObject(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asBoolean(value: unknown, defaultValue = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "y"].includes(normalized)) return true;
    if (["false", "no", "0", "n"].includes(normalized)) return false;
  }
  return defaultValue;
}

export type TenantClassOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type TenantSubject = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type TenantStaff = {
  id: string;
  staff_no: string;
  staff_type: string;
  role_code: string | null;
  primary_subject_id: string | null;
  primary_subject_code: string | null;
  primary_subject_name: string | null;
  employment_type: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_number: string | null;
  tsc_number: string | null;
  kra_pin: string | null;
  nssf_number: string | null;
  nhif_number: string | null;
  gender: string | null;
  date_of_birth: string | null;
  date_hired: string | null;
  next_of_kin_name: string | null;
  next_of_kin_relation: string | null;
  next_of_kin_phone: string | null;
  next_of_kin_email: string | null;
  address: string | null;
  notes: string | null;
  separation_status: string | null;
  separation_reason: string | null;
  separation_date: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type TeacherAssignment = {
  id: string;
  staff_id: string;
  staff_no: string;
  staff_name: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
  class_code: string;
  is_active: boolean;
  assigned_at: string | null;
  notes: string | null;
};

export type ClassTeacherAssignment = {
  id: string;
  staff_id: string;
  staff_no: string;
  staff_name: string;
  class_code: string;
  is_active: boolean;
  assigned_at: string | null;
  notes: string | null;
};

export type TenantAsset = {
  id: string;
  asset_code: string;
  name: string;
  category: string;
  description: string | null;
  condition_status: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type EnrollmentOption = {
  id: string;
  student_name: string;
  admission_number: string;
  class_code: string;
  status: string;
};

export type AssetAssignment = {
  id: string;
  asset_id: string;
  asset_code: string;
  asset_name: string;
  assignee_type: string;
  staff_id: string | null;
  staff_no: string | null;
  staff_name: string | null;
  class_code: string | null;
  enrollment_id: string | null;
  student_name: string | null;
  status: string;
  due_at: string | null;
  is_overdue: boolean;
  assigned_at: string | null;
  returned_at: string | null;
  notes: string | null;
};

export function normalizeClassOptions(input: unknown): TenantClassOption[] {
  return asArray<unknown>(input)
    .map((raw): TenantClassOption | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      const code = asString(row.code).toUpperCase();
      const name = asString(row.name);
      if (!id || !code || !name) return null;

      return {
        id,
        code,
        name,
        is_active: asBoolean(row.is_active, true),
      };
    })
    .filter((row): row is TenantClassOption => Boolean(row))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function normalizeSubjects(input: unknown): TenantSubject[] {
  return asArray<unknown>(input)
    .map((raw): TenantSubject | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      const code = asString(row.code).toUpperCase();
      const name = asString(row.name);
      if (!id || !code || !name) return null;

      return {
        id,
        code,
        name,
        is_active: asBoolean(row.is_active, true),
      };
    })
    .filter((row): row is TenantSubject => Boolean(row))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function normalizeStaff(input: unknown): TenantStaff[] {
  return asArray<unknown>(input)
    .map((raw): TenantStaff | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      const staffNo = asString(row.staff_no);
      const firstName = asString(row.first_name);
      const lastName = asString(row.last_name);
      if (!id || !staffNo || !firstName || !lastName) return null;

      const fullName = asString(row.full_name) || `${firstName} ${lastName}`.trim();

      return {
        id,
        staff_no: staffNo,
        staff_type: asString(row.staff_type).toUpperCase() || "TEACHING",
        role_code: asString(row.role_code) || null,
        primary_subject_id: asString(row.primary_subject_id) || null,
        primary_subject_code: asString(row.primary_subject_code) || null,
        primary_subject_name: asString(row.primary_subject_name) || null,
        employment_type: asString(row.employment_type) || null,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        email: asString(row.email) || null,
        phone: asString(row.phone) || null,
        id_number: asString(row.id_number) || null,
        tsc_number: asString(row.tsc_number) || null,
        kra_pin: asString(row.kra_pin) || null,
        nssf_number: asString(row.nssf_number) || null,
        nhif_number: asString(row.nhif_number) || null,
        gender: asString(row.gender) || null,
        date_of_birth: asString(row.date_of_birth) || null,
        date_hired: asString(row.date_hired) || null,
        next_of_kin_name: asString(row.next_of_kin_name) || null,
        next_of_kin_relation: asString(row.next_of_kin_relation) || null,
        next_of_kin_phone: asString(row.next_of_kin_phone) || null,
        next_of_kin_email: asString(row.next_of_kin_email) || null,
        address: asString(row.address) || null,
        notes: asString(row.notes) || null,
        separation_status: asString(row.separation_status) || null,
        separation_reason: asString(row.separation_reason) || null,
        separation_date: asString(row.separation_date) || null,
        is_active: asBoolean(row.is_active, true),
        created_at: asString(row.created_at) || null,
        updated_at: asString(row.updated_at) || null,
      };
    })
    .filter((row): row is TenantStaff => Boolean(row))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export function normalizeTeacherAssignments(input: unknown): TeacherAssignment[] {
  return asArray<unknown>(input)
    .map((raw): TeacherAssignment | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      if (!id) return null;

      return {
        id,
        staff_id: asString(row.staff_id),
        staff_no: asString(row.staff_no),
        staff_name: asString(row.staff_name) || "N/A",
        subject_id: asString(row.subject_id),
        subject_code: asString(row.subject_code),
        subject_name: asString(row.subject_name) || "N/A",
        class_code: asString(row.class_code).toUpperCase(),
        is_active: asBoolean(row.is_active, true),
        assigned_at: asString(row.assigned_at) || null,
        notes: asString(row.notes) || null,
      };
    })
    .filter((row): row is TeacherAssignment => Boolean(row))
    .sort((a, b) => {
      const classCmp = a.class_code.localeCompare(b.class_code);
      if (classCmp !== 0) return classCmp;
      const subjectCmp = a.subject_code.localeCompare(b.subject_code);
      if (subjectCmp !== 0) return subjectCmp;
      return a.staff_name.localeCompare(b.staff_name);
    });
}

export function normalizeClassTeacherAssignments(input: unknown): ClassTeacherAssignment[] {
  return asArray<unknown>(input)
    .map((raw): ClassTeacherAssignment | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      if (!id) return null;

      return {
        id,
        staff_id: asString(row.staff_id),
        staff_no: asString(row.staff_no),
        staff_name: asString(row.staff_name) || "N/A",
        class_code: asString(row.class_code).toUpperCase(),
        is_active: asBoolean(row.is_active, true),
        assigned_at: asString(row.assigned_at) || null,
        notes: asString(row.notes) || null,
      };
    })
    .filter((row): row is ClassTeacherAssignment => Boolean(row))
    .sort((a, b) => {
      const classCmp = a.class_code.localeCompare(b.class_code);
      if (classCmp !== 0) return classCmp;
      return a.staff_name.localeCompare(b.staff_name);
    });
}

export function normalizeAssets(input: unknown): TenantAsset[] {
  return asArray<unknown>(input)
    .map((raw): TenantAsset | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      const assetCode = asString(row.asset_code).toUpperCase();
      const name = asString(row.name);
      const category = asString(row.category);
      if (!id || !assetCode || !name || !category) return null;

      return {
        id,
        asset_code: assetCode,
        name,
        category,
        description: asString(row.description) || null,
        condition_status: asString(row.condition_status).toUpperCase() || "AVAILABLE",
        is_active: asBoolean(row.is_active, true),
        created_at: asString(row.created_at) || null,
        updated_at: asString(row.updated_at) || null,
      };
    })
    .filter((row): row is TenantAsset => Boolean(row))
    .sort((a, b) => a.asset_code.localeCompare(b.asset_code));
}

export function normalizeEnrollmentOptions(input: unknown): EnrollmentOption[] {
  return asArray<unknown>(input)
    .map((raw): EnrollmentOption | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      if (!id) return null;

      const payload = asObject(row.payload) || {};
      const studentName =
        asString(payload.student_name) ||
        asString(payload.studentName) ||
        asString(payload.full_name) ||
        asString(payload.fullName) ||
        asString(payload.name) ||
        "Unknown student";

      return {
        id,
        student_name: studentName,
        admission_number:
          asString(row.admission_number) ||
          asString(payload.admission_number) ||
          asString(payload.admissionNo) ||
          asString(payload.admission_no),
        class_code: (
          asString(payload.class_code) ||
          asString(payload.classCode)
        ).toUpperCase(),
        status: asString(row.status).toUpperCase() || "UNKNOWN",
      };
    })
    .filter((row): row is EnrollmentOption => Boolean(row))
    .sort((a, b) => a.student_name.localeCompare(b.student_name));
}

export function normalizeAssetAssignments(input: unknown): AssetAssignment[] {
  return asArray<unknown>(input)
    .map((raw): AssetAssignment | null => {
      const row = asObject(raw);
      if (!row) return null;

      const id = asString(row.id);
      if (!id) return null;

      return {
        id,
        asset_id: asString(row.asset_id),
        asset_code: asString(row.asset_code).toUpperCase(),
        asset_name: asString(row.asset_name) || "N/A",
        assignee_type: asString(row.assignee_type).toUpperCase() || "STAFF",
        staff_id: asString(row.staff_id) || null,
        staff_no: asString(row.staff_no) || null,
        staff_name: asString(row.staff_name) || null,
        class_code: asString(row.class_code).toUpperCase() || null,
        enrollment_id: asString(row.enrollment_id) || null,
        student_name: asString(row.student_name) || null,
        status: asString(row.status).toUpperCase() || "ASSIGNED",
        due_at: asString(row.due_at) || null,
        is_overdue: asBoolean(row.is_overdue, false),
        assigned_at: asString(row.assigned_at) || null,
        returned_at: asString(row.returned_at) || null,
        notes: asString(row.notes) || null,
      };
    })
    .filter((row): row is AssetAssignment => Boolean(row))
    .sort((a, b) => {
      const aDate = a.assigned_at || "";
      const bDate = b.assigned_at || "";
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return a.asset_code.localeCompare(b.asset_code);
    });
}
