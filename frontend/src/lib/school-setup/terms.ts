export type TenantTerm = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
  // Structured term identity used by invoice generation, payment summary,
  // and bulk-generation. Either may be null on legacy rows the backfill
  // could not parse; consumers must fall back gracefully.
  term_number?: number | null;
  academic_year?: number | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The term that should be selected by default — the current term (by date,
 * flagged `is_current` from the backend), falling back to the first term.
 * Returns the term id, or "" if there are none.
 */
export function defaultTermId(terms: TenantTerm[]): string {
  if (!terms.length) return "";
  return (terms.find((t) => t.is_current) ?? terms[0]).id;
}

export function buildDefaultTerms(now = new Date()): TenantTerm[] {
  const year = now.getFullYear();
  return [
    { id: `fallback-${year}-t1`, code: `T1-${year}`, name: `Term 1 (${year})`, is_active: true },
    { id: `fallback-${year}-t2`, code: `T2-${year}`, name: `Term 2 (${year})`, is_active: true },
    { id: `fallback-${year}-t3`, code: `T3-${year}`, name: `Term 3 (${year})`, is_active: true },
  ];
}

export function normalizeTerms(input: unknown): TenantTerm[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((row, idx): TenantTerm | null => {
      if (!row || typeof row !== "object") return null;
      const rec = row as Record<string, unknown>;

      const code =
        asString(rec.code) ||
        asString(rec.term_code) ||
        asString(rec.slug) ||
        `TERM_${idx + 1}`;

      const name =
        asString(rec.name) ||
        asString(rec.term_name) ||
        code.replace(/_/g, " ");

      if (!name) return null;

      const tn = rec.term_number;
      const ay = rec.academic_year;
      return {
        id: asString(rec.id) || `term-${code.toLowerCase()}-${idx}`,
        code,
        name,
        is_active: typeof rec.is_active === "boolean" ? rec.is_active : true,
        start_date: asString(rec.start_date) || null,
        end_date: asString(rec.end_date) || null,
        is_current: rec.is_current === true,
        term_number:
          typeof tn === "number" && Number.isFinite(tn) && tn >= 1 && tn <= 3
            ? tn
            : null,
        academic_year:
          typeof ay === "number" && Number.isFinite(ay) && ay >= 2000 && ay <= 2199
            ? ay
            : null,
      };
    })
    .filter((row): row is TenantTerm => Boolean(row))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The current term's structured (term_number, academic_year). Returns null
 * when no current term is set, or when the current term hasn't been tagged
 * with the structured identity yet. Consumers (invoice form, record-payment
 * summary) fall back to local defaults in that case.
 */
export function currentTermIdentity(
  terms: TenantTerm[]
): { term_number: number; academic_year: number } | null {
  if (!terms.length) return null;
  const current = terms.find((t) => t.is_current) ?? null;
  if (!current) return null;
  if (current.term_number == null || current.academic_year == null) return null;
  return {
    term_number: current.term_number,
    academic_year: current.academic_year,
  };
}

export function termFromPayload(payload: Record<string, unknown>): string {
  const candidates = [
    payload.admission_term,
    payload.term,
    payload.term_code,
    payload.academic_term,
    payload.academicTerm,
  ];

  for (const value of candidates) {
    const resolved = asString(value);
    if (resolved) return resolved;
  }

  return "";
}
