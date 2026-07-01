"use client";

/**
 * TablePaginationFooter — shared pagination row for every paginated
 * finance table. Sits BELOW the table (per director spec) with a tiny
 * 30/50/100 page-size dropdown on the left and prev/next + "Page X of Y"
 * on the right.
 */

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PageMeta } from "@/lib/usePaginatedTable";
import { DEFAULT_PAGE_SIZE_OPTIONS } from "@/lib/usePaginatedTable";

type Props = {
  meta: PageMeta;
  page: number;
  pageSize: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Optional page-size options — defaults to 30/50/100. */
  pageSizeOptions?: readonly number[];
};

export function TablePaginationFooter({
  meta,
  page,
  pageSize,
  loading = false,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: Props) {
  return (
    <div className="mt-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>Page size</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        {loading && (
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="tabular-nums">
          Page <strong>{meta.page}</strong> of <strong>{meta.pages}</strong>
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          disabled={page >= meta.pages || loading}
          onClick={() => onPageChange(Math.min(meta.pages, page + 1))}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}


/** "Showing X–Y of Z" caption. Renders "No results" when total is 0. */
export function TableRangeCaption({ meta }: { meta: PageMeta }) {
  if (meta.total <= 0) return <>No results.</>;
  const from = (meta.page - 1) * meta.page_size + 1;
  const to = Math.min(meta.page * meta.page_size, meta.total);
  return (
    <>
      Showing <strong>{from}–{to}</strong> of <strong>{meta.total}</strong>
    </>
  );
}
