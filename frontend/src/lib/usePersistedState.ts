"use client";

import { useEffect, useRef, useState } from "react";

/**
 * State that survives data reloads, edits, navigation and full page refreshes —
 * persisted to sessionStorage under a stable key. Used for table page numbers,
 * filters and search boxes so a table never jumps back to page 1 (or clears its
 * filter) after a minor edit; it only changes when the user changes it.
 *
 * SSR-safe: the server and first client render use `initial` (so there is no
 * hydration mismatch), then the stored value is restored in an effect.
 *
 * Keys must be unique per table/field, e.g. "secretary.finance.invoices.page".
 */
export function usePersistedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const restored = useRef(false);

  // Restore once, after hydration.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore unavailable/corrupt storage */
    }
    restored.current = true;
    // key is stable per mount; restore only once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change — but not the initial default before we've restored,
  // otherwise we'd clobber the saved value on mount.
  useEffect(() => {
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
