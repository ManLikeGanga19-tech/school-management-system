export type TenantTerm = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
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

      return {
        id: asString(rec.id) || `term-${code.toLowerCase()}-${idx}`,
        code,
        name,
        is_active: typeof rec.is_active === "boolean" ? rec.is_active : true,
        start_date: asString(rec.start_date) || null,
        end_date: asString(rec.end_date) || null,
        is_current: rec.is_current === true,
      };
    })
    .filter((row): row is TenantTerm => Boolean(row))
    .sort((a, b) => a.name.localeCompare(b.name));
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
