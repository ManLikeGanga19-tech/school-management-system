import { termFromPayload, type TenantTerm } from "@/lib/school-setup/terms";
import { asArray } from "@/lib/utils/asArray";

export type EnrollmentRow = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
  admission_number?: string | null;
};

export type FinanceInvoice = {
  id: string;
  invoice_type: string;
  status: string;
  enrollment_id: string | null;
  currency: string;
  total_amount: string | number;
  paid_amount: string | number;
  balance_amount: string | number;
};

export type FeeStructure = {
  id: string;
  class_code: string;
  term_code?: string;
  name: string;
  is_active: boolean;
};

export type FeeStructureItem = {
  fee_item_id: string;
  amount: string | number;
  fee_item_code: string;
  fee_item_name: string;
  category_id: string;
  category_code: string;
  category_name: string;
};

export type FinanceSnapshot = {
  enrollments: EnrollmentRow[];
  invoices: FinanceInvoice[];
  fee_structures: FeeStructure[];
  fee_structure_items: Record<string, FeeStructureItem[]>;
};

export type StudentFeeBalanceRow = {
  enrollment_id: string;
  student_name: string;
  admission_number: string;
  class_code: string;
  enrollment_term: string;
  status: string;
  current_term_code: string;
  current_term_fee: number;
  current_term_paid: number;
  current_term_balance: number;
  full_structure_total: number;
  total_paid: number;
  full_balance: number;
  total_invoiced: number;
  invoice_count: number;
  has_structure: boolean;
  fee_structure_name: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

export function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function payloadString(
  payload: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function payloadBoolean(
  payload: Record<string, unknown>,
  keys: string[]
): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(normalized)) return true;
      if (["false", "no", "n", "0"].includes(normalized)) return false;
    }
  }
  return false;
}

export function studentName(payload: Record<string, unknown>): string {
  for (const key of [
    "student_name",
    "studentName",
    "full_name",
    "fullName",
    "name",
  ]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Unknown student";
}

export function studentClass(payload: Record<string, unknown>): string {
  for (const key of ["admission_class", "class_code", "classCode", "grade"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function admissionNumber(row: EnrollmentRow): string {
  const payloadAdm = payloadString(row.payload || {}, [
    "admission_number",
    "admissionNo",
    "admission_no",
  ]);
  return (row.admission_number || payloadAdm || "").trim();
}

export function normalizeEnrollmentRows(input: unknown): EnrollmentRow[] {
  const rows: EnrollmentRow[] = [];
  const seen = new Set<string>();

  for (const raw of asArray<unknown>(input)) {
    const obj = asObject(raw);
    if (!obj) continue;
    const id = asString(obj.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const payload = asObject(obj.payload) || {};

    rows.push({
      id,
      status: asString(obj.status).toUpperCase() || "UNKNOWN",
      payload,
      admission_number: asString(obj.admission_number) || null,
    });
  }

  return rows;
}

function normalizeInvoices(input: unknown): FinanceInvoice[] {
  const rows: FinanceInvoice[] = [];
  for (const raw of asArray<unknown>(input)) {
    const obj = asObject(raw);
    if (!obj) continue;
    const id = asString(obj.id);
    if (!id) continue;

    rows.push({
      id,
      invoice_type: asString(obj.invoice_type).toUpperCase(),
      status: asString(obj.status).toUpperCase(),
      enrollment_id: asString(obj.enrollment_id) || null,
      currency: asString(obj.currency) || "KES",
      total_amount: asString(obj.total_amount) || "0",
      paid_amount: asString(obj.paid_amount) || "0",
      balance_amount: asString(obj.balance_amount) || "0",
    });
  }
  return rows;
}

function normalizeFeeStructures(input: unknown): FeeStructure[] {
  const rows: FeeStructure[] = [];
  for (const raw of asArray<unknown>(input)) {
    const obj = asObject(raw);
    if (!obj) continue;
    const id = asString(obj.id);
    if (!id) continue;

    rows.push({
      id,
      class_code: asString(obj.class_code).toUpperCase(),
      term_code: asString(obj.term_code).toUpperCase() || "GENERAL",
      name: asString(obj.name) || "Fee Structure",
      is_active: obj.is_active === false ? false : true,
    });
  }
  return rows;
}

function normalizeFeeStructureItems(
  input: unknown
): Record<string, FeeStructureItem[]> {
  const obj = asObject(input);
  if (!obj) return {};

  const result: Record<string, FeeStructureItem[]> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (!key.trim()) continue;
    const items: FeeStructureItem[] = [];

    for (const raw of asArray<unknown>(value)) {
      const item = asObject(raw);
      if (!item) continue;
      items.push({
        fee_item_id: asString(item.fee_item_id),
        amount: asString(item.amount) || "0",
        fee_item_code: asString(item.fee_item_code),
        fee_item_name: asString(item.fee_item_name),
        category_id: asString(item.category_id),
        category_code: asString(item.category_code),
        category_name: asString(item.category_name),
      });
    }

    result[key] = items;
  }

  return result;
}

export function normalizeFinanceSnapshot(input: unknown): FinanceSnapshot {
  const obj = asObject(input) || {};
  return {
    enrollments: normalizeEnrollmentRows(obj.enrollments),
    invoices: normalizeInvoices(obj.invoices),
    fee_structures: normalizeFeeStructures(obj.fee_structures),
    fee_structure_items: normalizeFeeStructureItems(obj.fee_structure_items),
  };
}

function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function resolveCurrentTerm(
  terms: TenantTerm[],
  now = new Date()
): TenantTerm | null {
  if (terms.length === 0) return null;

  const active = terms.filter((term) => term.is_active !== false);
  const working = active.length > 0 ? active : terms;

  const inRange = working.find((term) => {
    const start = parseIsoDate(term.start_date);
    const end = parseIsoDate(term.end_date);
    const startsOk = !start || start <= now;
    const endsOk = !end || end >= now;
    return startsOk && endsOk;
  });
  if (inRange) return inRange;

  const started = working
    .map((term) => ({ term, start: parseIsoDate(term.start_date) }))
    .filter((row): row is { term: TenantTerm; start: Date } => Boolean(row.start))
    .filter((row) => row.start <= now)
    .sort((a, b) => b.start.getTime() - a.start.getTime());
  if (started.length > 0) return started[0].term;

  return working[0] ?? null;
}

function isSchoolFeesInvoice(invoiceType: string): boolean {
  const normalized = invoiceType.toUpperCase();
  if (!normalized) return true;
  if (normalized.includes("INTERVIEW")) return false;
  if (normalized.includes("SCHOOL") || normalized.includes("FEE")) return true;
  return false;
}

function structureTotal(
  structureId: string,
  allItems: Record<string, FeeStructureItem[]>
): number {
  const items = asArray<FeeStructureItem>(allItems[structureId]);
  return items.reduce((sum, item) => sum + toNumber(item.amount), 0);
}

function pickStructureForStudent(
  row: EnrollmentRow,
  feeStructures: FeeStructure[],
  currentTermCode: string
): FeeStructure | null {
  const payload = row.payload || {};

  const explicitStructureId = payloadString(payload, [
    "_fee_structure_id",
    "fee_structure_id",
    "assigned_fee_structure_id",
    "finance_fee_structure_id",
  ]);
  if (explicitStructureId) {
    const byId = feeStructures.find((item) => item.id === explicitStructureId);
    if (byId) return byId;
  }

  const classCode = normalizeCode(studentClass(payload));
  if (!classCode) return null;

  const structuresByClass = feeStructures.filter(
    (item) => normalizeCode(item.class_code) === classCode
  );
  if (structuresByClass.length === 0) return null;

  const enrollmentTerm = normalizeCode(termFromPayload(payload));
  if (currentTermCode) {
    const byCurrentTerm = structuresByClass.find(
      (item) => normalizeCode(item.term_code || "GENERAL") === currentTermCode
    );
    if (byCurrentTerm) return byCurrentTerm;
  }

  if (enrollmentTerm) {
    const byEnrollmentTerm = structuresByClass.find(
      (item) => normalizeCode(item.term_code || "GENERAL") === enrollmentTerm
    );
    if (byEnrollmentTerm) return byEnrollmentTerm;
  }

  return structuresByClass[0];
}

export function buildStudentFeeBalanceRows(
  snapshot: FinanceSnapshot,
  terms: TenantTerm[]
): { rows: StudentFeeBalanceRow[]; currentTermCode: string } {
  const currentTerm = resolveCurrentTerm(terms);
  const currentTermCode = normalizeCode(currentTerm?.code || "");

  const invoicesByEnrollment = new Map<string, FinanceInvoice[]>();
  for (const invoice of snapshot.invoices) {
    const enrollmentId = asString(invoice.enrollment_id);
    if (!enrollmentId) continue;
    const list = invoicesByEnrollment.get(enrollmentId) || [];
    list.push(invoice);
    invoicesByEnrollment.set(enrollmentId, list);
  }

  const structuresByClass = new Map<string, FeeStructure[]>();
  for (const structure of snapshot.fee_structures) {
    const classCode = normalizeCode(structure.class_code);
    if (!classCode) continue;
    const list = structuresByClass.get(classCode) || [];
    list.push(structure);
    structuresByClass.set(classCode, list);
  }

  const rows: StudentFeeBalanceRow[] = snapshot.enrollments
    .map((row) => {
      const payload = row.payload || {};
      const classCode = studentClass(payload).toUpperCase();
      const enrollmentTerm = termFromPayload(payload).toUpperCase();
      const chosenStructure = pickStructureForStudent(
        row,
        snapshot.fee_structures,
        currentTermCode
      );
      const chosenStructureTotal = chosenStructure
        ? structureTotal(chosenStructure.id, snapshot.fee_structure_items)
        : 0;

      const classStructures = structuresByClass.get(normalizeCode(classCode)) || [];
      const fullStructureTotal = classStructures.reduce(
        (sum, structure) => sum + structureTotal(structure.id, snapshot.fee_structure_items),
        0
      );

      const enrollmentInvoices = asArray<FinanceInvoice>(
        invoicesByEnrollment.get(row.id)
      ).filter((invoice) => isSchoolFeesInvoice(invoice.invoice_type));

      const totalInvoiced = enrollmentInvoices.reduce(
        (sum, invoice) => sum + toNumber(invoice.total_amount),
        0
      );
      const totalPaid = enrollmentInvoices.reduce(
        (sum, invoice) => sum + toNumber(invoice.paid_amount),
        0
      );
      const invoiceBalance = enrollmentInvoices.reduce(
        (sum, invoice) => sum + toNumber(invoice.balance_amount),
        0
      );

      const currentTermFee = chosenStructureTotal;
      const currentTermPaid = Math.min(totalPaid, currentTermFee);
      const currentTermBalance = Math.max(currentTermFee - currentTermPaid, 0);

      const resolvedFullTotal =
        fullStructureTotal > 0 ? fullStructureTotal : totalInvoiced;
      const fullBalance =
        totalInvoiced > 0
          ? Math.max(invoiceBalance, 0)
          : Math.max(resolvedFullTotal - totalPaid, 0);

      return {
        enrollment_id: row.id,
        student_name: studentName(payload),
        admission_number: admissionNumber(row),
        class_code: classCode,
        enrollment_term: enrollmentTerm,
        status: row.status,
        current_term_code: currentTermCode,
        current_term_fee: currentTermFee,
        current_term_paid: currentTermPaid,
        current_term_balance: currentTermBalance,
        full_structure_total: resolvedFullTotal,
        total_paid: totalPaid,
        full_balance: fullBalance,
        total_invoiced: totalInvoiced,
        invoice_count: enrollmentInvoices.length,
        has_structure: Boolean(chosenStructure),
        fee_structure_name: chosenStructure?.name || "Not linked",
      };
    })
    .sort((a, b) => a.student_name.localeCompare(b.student_name));

  return { rows, currentTermCode };
}
