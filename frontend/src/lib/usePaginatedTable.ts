"use client";

/**
 * usePaginatedTable — shared hook for server-paginated tables in the
 * finance module (invoices, payments, receipts, and the config tables).
 *
 * What it does:
 *   * Owns page + pageSize + filters + debounced search state.
 *   * Fetches from a paginated JSON endpoint returning {items, meta}.
 *   * Syncs page + pageSize into the URL via `keyPrefix` so each table's
 *     state is bookmarkable independently on the same page.
 *   * Resets to page 1 when a filter changes so the user doesn't land
 *     on "page 5" of a set that just shrunk to 12 rows.
 *   * Debounces `q` by 300ms so keystrokes don't hammer the API.
 *
 * Contract:
 *   The endpoint MUST return `{items: T[], meta: {total, page, page_size, pages}}`.
 *   Filters are pushed as query params with the same name; falsy values
 *   are omitted so the URL stays clean.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { api } from "@/lib/api";

export type PageMeta = { total: number; page: number; page_size: number; pages: number };

export type PaginatedResponse<T> = { items: T[]; meta: PageMeta };

export type PaginatedTableState<T, F extends Record<string, unknown>> = {
  items: T[];
  meta: PageMeta;
  page: number;
  pageSize: number;
  filters: F;
  loading: boolean;
  error: string | null;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  setFilters: (updater: (prev: F) => F) => void;
  reload: () => Promise<void>;
};

export const DEFAULT_PAGE_SIZE_OPTIONS = [30, 50, 100] as const;

type Options<F> = {
  /** Backend endpoint path (relative to /api/v1). */
  endpoint: string;
  /** URL-param prefix — e.g. "inv" → inv_page, inv_size. Must be unique per
   *  table on the same page so multiple tables don't fight over the URL. */
  keyPrefix: string;
  /** Initial filter values. `q` is the standard search key across all tables. */
  initialFilters: F;
  /** Default page size (must be in DEFAULT_PAGE_SIZE_OPTIONS). */
  defaultPageSize?: number;
  /** Filters that should be persisted to the URL alongside pagination.
   *  Defaults to none — most tables persist only page + pageSize. */
  urlPersistedFilterKeys?: (keyof F)[];
  /** Filters that should NOT trigger a debounce (selects, dates fire once). */
  nonDebouncedFilterKeys?: (keyof F)[];
  /** Whether to fetch immediately on mount + when deps change. */
  enabled?: boolean;
};

function isPageSize(n: number): n is 30 | 50 | 100 {
  return (DEFAULT_PAGE_SIZE_OPTIONS as readonly number[]).includes(n);
}

export function usePaginatedTable<T, F extends { q?: string } & Record<string, unknown>>(
  opts: Options<F>,
): PaginatedTableState<T, F> {
  const {
    endpoint,
    keyPrefix,
    initialFilters,
    defaultPageSize = 30,
    urlPersistedFilterKeys = [],
    enabled = true,
  } = opts;

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const initialPage = (() => {
    const raw = Number(searchParams.get(`${keyPrefix}_page`));
    return Number.isFinite(raw) && raw >= 1 ? raw : 1;
  })();
  const initialPageSize = (() => {
    const raw = Number(searchParams.get(`${keyPrefix}_size`));
    return isPageSize(raw) ? raw : defaultPageSize;
  })();

  const [page, setPage] = useState<number>(initialPage);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const [filters, setFilters] = useState<F>(() => {
    // Restore URL-persisted filters if any.
    const restored: Record<string, unknown> = { ...initialFilters };
    for (const key of urlPersistedFilterKeys) {
      const v = searchParams.get(`${keyPrefix}_${String(key)}`);
      if (v != null) restored[String(key)] = v;
    }
    return restored as F;
  });

  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState<PageMeta>({
    total: 0, page: initialPage, page_size: initialPageSize, pages: 1,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search text so each keystroke doesn't trigger a fetch.
  const [debouncedQ, setDebouncedQ] = useState<string>(String(filters.q ?? ""));
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(String(filters.q ?? "")), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  // Serialize all non-q filters into a fingerprint so we can detect real
  // changes and reset to page 1 when they change.
  const nonQFingerprint = JSON.stringify(
    Object.fromEntries(
      Object.entries(filters).filter(([k]) => k !== "q"),
    ),
  );
  const filterFingerprint = `${debouncedQ}|${nonQFingerprint}`;
  const prevFpRef = useRef(filterFingerprint);
  useEffect(() => {
    if (prevFpRef.current !== filterFingerprint) {
      prevFpRef.current = filterFingerprint;
      setPage(1);
    }
  }, [filterFingerprint]);

  const fetchOnce = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
      for (const [key, value] of Object.entries(filters)) {
        if (key === "q") continue;
        if (value == null) continue;
        if (typeof value === "boolean") {
          if (value) params.set(key, "true");
          continue;
        }
        const s = String(value);
        if (s) params.set(key, s);
      }
      const url = `${endpoint}?${params.toString()}`;
      const resp = await api.get<PaginatedResponse<T>>(url, { tenantRequired: true });
      setItems(Array.isArray(resp?.items) ? resp.items : []);
      if (resp?.meta) setMeta(resp.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load table");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [
    enabled, endpoint, page, pageSize, debouncedQ, filters,
  ]);

  useEffect(() => { void fetchOnce(); }, [fetchOnce]);

  // Sync page + pageSize + URL-persisted filters to the URL.
  useEffect(() => {
    if (!enabled) return;
    const next = new URLSearchParams(searchParams.toString());
    if (page > 1) next.set(`${keyPrefix}_page`, String(page));
    else next.delete(`${keyPrefix}_page`);
    if (pageSize !== defaultPageSize) next.set(`${keyPrefix}_size`, String(pageSize));
    else next.delete(`${keyPrefix}_size`);
    for (const key of urlPersistedFilterKeys) {
      const v = filters[key];
      const paramKey = `${keyPrefix}_${String(key)}`;
      if (v != null && String(v)) next.set(paramKey, String(v));
      else next.delete(paramKey);
    }
    const qs = next.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    router.replace(target, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filterFingerprint, enabled]);

  return {
    items, meta, page, pageSize, filters, loading, error,
    setPage, setPageSize, setFilters, reload: fetchOnce,
  };
}
