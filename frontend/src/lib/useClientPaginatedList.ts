"use client";

/**
 * useClientPaginatedList — client-side pagination hook that mimics the
 * interface of usePaginatedTable so the same TablePaginationFooter +
 * TableRangeCaption components render for both server-paginated and
 * client-paginated tables.
 *
 * Rationale
 * ---------
 * The finance config tables (fee categories, fee items, fee structures,
 * scholarships, structure policies) are POLICY-BOUNDED: their row count
 * is capped by school policy, not by student activity. A well-run school
 * has 10–30 fee items, not 10,000. Server-side pagination on those tables
 * adds a round-trip per keystroke + more code paths for no user-visible
 * benefit.
 *
 * Higher-cardinality tables (invoices, payments, receipts) use the
 * server-side usePaginatedTable hook instead. Both hooks expose the SAME
 * shape so the shared UI components render identically and a table can
 * be promoted from client-side to server-side later without touching
 * anything but the hook call.
 *
 * Behaviour
 * ---------
 *   * Debounces `q` (250ms) so a big source array doesn't re-filter on
 *     every keystroke.
 *   * Resets to page 1 whenever any filter changes — matches the
 *     server-side hook's behaviour so users don't land on a stale page.
 *   * `filterFn` lets each caller define its own search/filter logic;
 *     when omitted, falls back to a JSON-stringify blob-match on `q`.
 *   * `pages` is always >= 1 so the pagination footer renders safely
 *     even for empty tables.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { PageMeta } from "@/lib/usePaginatedTable";

export const DEFAULT_PAGE_SIZE_OPTIONS = [30, 50, 100] as const;

export type ClientPaginatedTableState<T, F extends Record<string, unknown>> = {
  items: T[];
  meta: PageMeta;
  page: number;
  pageSize: number;
  filters: F;
  loading: false;
  error: null;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  setFilters: (updater: (prev: F) => F) => void;
  reload: () => void;
  /** Total rows AFTER filters (for cases where the caller wants to render
   *  "3 of 87 categories" style captions). */
  filteredTotal: number;
};

type Options<T, F extends Record<string, unknown>> = {
  /** Full source array — normally comes straight from the bulk payload. */
  source: T[];
  initialFilters: F;
  defaultPageSize?: number;
  /** Custom filter — receives the raw item + current filters + debounced q. */
  filterFn?: (item: T, filters: F, debouncedQ: string) => boolean;
};

export function useClientPaginatedList<
  T,
  F extends { q?: string } & Record<string, unknown>,
>(opts: Options<T, F>): ClientPaginatedTableState<T, F> {
  const { source, initialFilters, defaultPageSize = 30, filterFn } = opts;

  const [filters, setFilters] = useState<F>(initialFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);

  // Debounced q to avoid recomputing filtered every keystroke.
  const [debouncedQ, setDebouncedQ] = useState<string>(String(filters.q ?? ""));
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(String(filters.q ?? "")), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  // Reset to page 1 whenever any filter (or q) changes.
  const nonQFingerprint = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(Object.entries(filters).filter(([k]) => k !== "q")),
      ),
    [filters],
  );
  const filterFingerprint = `${debouncedQ}|${nonQFingerprint}`;
  const prevFpRef = useRef(filterFingerprint);
  useEffect(() => {
    if (prevFpRef.current !== filterFingerprint) {
      prevFpRef.current = filterFingerprint;
      setPage(1);
    }
  }, [filterFingerprint]);

  const filtered = useMemo(() => {
    if (!filterFn) {
      const q = debouncedQ.trim().toLowerCase();
      if (!q) return source;
      // Default filter: stringify each row and substring-match.
      return source.filter((item) =>
        JSON.stringify(item).toLowerCase().includes(q),
      );
    }
    return source.filter((item) =>
      filterFn(item, filters, debouncedQ.trim().toLowerCase()),
    );
  }, [source, filters, debouncedQ, filterFn]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    meta: { total, page: safePage, page_size: pageSize, pages },
    page: safePage,
    pageSize,
    filters,
    loading: false,
    error: null,
    setPage,
    setPageSize,
    setFilters,
    reload: () => {
      /* no-op — client-side hook has nothing to refetch. */
    },
    filteredTotal: total,
  };
}
