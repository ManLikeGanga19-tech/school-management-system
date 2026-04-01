// ─── Shared Finance Types ─────────────────────────────────────────────────────

export type FeeCategory = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type ChargeFrequency = "PER_TERM" | "ONCE_PER_YEAR" | "ONCE_EVER";
export type StudentType = "NEW" | "RETURNING";

export type FeeItem = {
  id: string;
  category_id: string;
  code: string;
  name: string;
  charge_frequency: ChargeFrequency;
  is_active: boolean;
};

export type FeeStructure = {
  id: string;
  structure_no?: string | null;
  class_code: string;
  academic_year: number;
  student_type: StudentType;
  name: string;
  is_active: boolean;
};

export type FeeStructureItem = {
  fee_item_id: string;
  term_1_amount: string | number;
  term_2_amount: string | number;
  term_3_amount: string | number;
  charge_frequency: ChargeFrequency;
  fee_item_code: string;
  fee_item_name: string;
  category_id: string;
  category_code: string;
  category_name: string;
};

export type Scholarship = {
  id: string;
  name: string;
  type: string;
  value: string | number;
  is_active: boolean;
};

export type FinanceSetupData = {
  fee_categories: FeeCategory[];
  fee_items: FeeItem[];
  fee_structures: FeeStructure[];
  fee_structure_items: Record<string, FeeStructureItem[]>;
  scholarships: Scholarship[];
};

export type StructureRowDraft = {
  fee_item_id?: string;
  tempId?: string;
  fee_item_code: string;
  fee_item_name: string;
  category_id: string;
  category_code: string;
  category_name: string;
  term_1_amount: string;
  term_2_amount: string;
  term_3_amount: string;
  charge_frequency: ChargeFrequency;
};

// ─── Shared Helpers ───────────────────────────────────────────────────────────

export function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatAmount(value: string | number | null | undefined): string {
  return formatKes(toNumber(value));
}

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

export function normalizeClassCode(value: string): string {
  return value.trim().toUpperCase();
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readApiError(value: unknown, fallback: string): string {
  const obj = asObject(value);
  if (!obj) return fallback;
  if (typeof obj.detail === "string" && obj.detail.trim()) return obj.detail;
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  return fallback;
}
