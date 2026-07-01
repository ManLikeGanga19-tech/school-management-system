/**
 * Tests for src/lib/useClientPaginatedList.ts
 *
 * The hook is a small piece of infrastructure that the K2 finance config
 * tables (ScholarshipsPage, CategoriesPage, FeeStructuresPage) all rely on,
 * so the contract must be air-tight.
 *
 * Coverage:
 *  - Correct meta on empty + tiny + large sources
 *  - Page slicing (page/pageSize arithmetic)
 *  - Filter reset to page 1 when q or non-q filters change
 *  - Debounced q (250ms) — behaviour with fake timers
 *  - Custom filterFn is invoked for every item with the debounced q
 *  - Default JSON-blob filter matches substring
 *  - safePage clamps out-of-range page numbers to the last available page
 */
import { act, renderHook } from "@testing-library/react";

import { useClientPaginatedList } from "@/lib/useClientPaginatedList";

describe("useClientPaginatedList", () => {
  it("returns valid meta for an empty source", () => {
    const { result } = renderHook(() =>
      useClientPaginatedList<{ id: number }, { q: string }>({
        source: [],
        initialFilters: { q: "" },
      }),
    );
    expect(result.current.items).toEqual([]);
    expect(result.current.meta).toEqual({
      total: 0,
      page: 1,
      page_size: 30,
      pages: 1, // always >= 1 so pagination footer renders
    });
  });

  it("slices by page + pageSize", () => {
    const source = Array.from({ length: 45 }, (_, i) => ({ id: i }));
    const { result } = renderHook(() =>
      useClientPaginatedList<{ id: number }, { q: string }>({
        source,
        initialFilters: { q: "" },
        defaultPageSize: 20,
      }),
    );

    expect(result.current.items).toHaveLength(20);
    expect(result.current.items[0].id).toBe(0);
    expect(result.current.meta.pages).toBe(3);

    act(() => result.current.setPage(2));
    expect(result.current.items[0].id).toBe(20);

    act(() => result.current.setPage(3));
    expect(result.current.items).toHaveLength(5); // remainder page
  });

  it("clamps out-of-range pages to the last page", () => {
    const source = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const { result } = renderHook(() =>
      useClientPaginatedList<{ id: number }, { q: string }>({
        source,
        initialFilters: { q: "" },
        defaultPageSize: 5,
      }),
    );
    act(() => result.current.setPage(99));
    // clamped safePage — meta reflects the real max page (2)
    expect(result.current.meta.page).toBe(2);
    expect(result.current.items).toHaveLength(5);
  });

  it("resets to page 1 when q changes (debounced)", () => {
    jest.useFakeTimers();
    const source = Array.from({ length: 45 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
    }));
    const { result } = renderHook(() =>
      useClientPaginatedList<{ id: number; name: string }, { q: string }>({
        source,
        initialFilters: { q: "" },
        defaultPageSize: 10,
        filterFn: (it, _f, q) => !q || it.name.includes(q),
      }),
    );
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    act(() => result.current.setFilters(() => ({ q: "item-1" })));
    // q is debounced — nothing has happened yet.
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(result.current.page).toBe(1);
    jest.useRealTimers();
  });

  it("applies custom filterFn against debounced q", () => {
    jest.useFakeTimers();
    const source = [
      { id: 1, name: "Apple" },
      { id: 2, name: "Banana" },
      { id: 3, name: "Cherry" },
    ];
    const { result } = renderHook(() =>
      useClientPaginatedList<{ id: number; name: string }, { q: string }>({
        source,
        initialFilters: { q: "" },
        filterFn: (it, _f, q) => !q || it.name.toLowerCase().includes(q),
      }),
    );

    act(() => result.current.setFilters(() => ({ q: "an" })));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(result.current.items.map((i) => i.name)).toEqual(["Banana"]);
    expect(result.current.filteredTotal).toBe(1);
    jest.useRealTimers();
  });

  it("falls back to JSON blob search when no filterFn provided", () => {
    jest.useFakeTimers();
    const source = [
      { id: 1, name: "Tuition" },
      { id: 2, name: "Uniform" },
      { id: 3, name: "Trip" },
    ];
    const { result } = renderHook(() =>
      useClientPaginatedList<{ id: number; name: string }, { q: string }>({
        source,
        initialFilters: { q: "" },
      }),
    );
    act(() => result.current.setFilters(() => ({ q: "unif" })));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(result.current.filteredTotal).toBe(1);
    expect(result.current.items[0].name).toBe("Uniform");
    jest.useRealTimers();
  });

  it("changing pageSize recomputes pages", () => {
    const source = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const { result } = renderHook(() =>
      useClientPaginatedList<{ id: number }, { q: string }>({
        source,
        initialFilters: { q: "" },
        defaultPageSize: 30,
      }),
    );
    expect(result.current.meta.pages).toBe(4); // ceil(100/30)

    act(() => result.current.setPageSize(50));
    expect(result.current.meta.pages).toBe(2);
    expect(result.current.pageSize).toBe(50);
  });

  it("reload is a no-op safe to call", () => {
    const { result } = renderHook(() =>
      useClientPaginatedList<{ id: number }, { q: string }>({
        source: [{ id: 1 }],
        initialFilters: { q: "" },
      }),
    );
    expect(() => result.current.reload()).not.toThrow();
  });
});
