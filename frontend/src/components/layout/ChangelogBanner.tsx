"use client";

/**
 * ChangelogBanner — the in-app "What's New" notice. Shows every changelog
 * entry the current user hasn't acknowledged yet; each is expandable.
 * "Got it" marks them all seen. Renders nothing when there's nothing new.
 */
import { useEffect, useState } from "react";
import { Sparkles, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

type Entry = {
  id: string;
  title: string;
  body: string;
  category: string;
  published_at: string | null;
};

const CATEGORY: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-teal-100 text-teal-700" },
  improved: { label: "Improved", cls: "bg-blue-100 text-blue-700" },
  fixed: { label: "Fixed", cls: "bg-slate-200 text-slate-600" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-KE", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function ChangelogBanner() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dismissing, setDismissing] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch<Entry[]>("/changelog/unseen", { tenantRequired: true } as never)
      .then((d) => {
        if (active) setEntries(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        /* changelog is non-critical — stay silent on failure */
      });
    return () => {
      active = false;
    };
  }, []);

  if (hidden || entries.length === 0) return null;

  async function dismiss() {
    setDismissing(true);
    try {
      await apiFetch("/changelog/seen", {
        method: "POST",
        tenantRequired: true,
      } as never);
      setHidden(true);
    } catch {
      setDismissing(false);
    }
  }

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-teal-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-teal-100 bg-teal-50 px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-teal-600" />
        <span className="text-sm font-semibold text-teal-800">
          What&rsquo;s New
        </span>
        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-700">
          {entries.length} update{entries.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {entries.map((e) => {
          const open = !!expanded[e.id];
          const cat = CATEGORY[e.category] ?? CATEGORY.new;
          return (
            <div key={e.id}>
              <button
                type="button"
                onClick={() =>
                  setExpanded((m) => ({ ...m, [e.id]: !m[e.id] }))
                }
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cat.cls}`}
                >
                  {cat.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                  {e.title}
                </span>
                {e.published_at && (
                  <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
                    {formatDate(e.published_at)}
                  </span>
                )}
                {open ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                )}
              </button>
              {open && (
                <p className="whitespace-pre-wrap px-4 pb-3 text-sm leading-relaxed text-slate-600">
                  {e.body}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-4 py-2.5">
        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={dismissing}
          className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {dismissing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Got it
        </button>
      </div>
    </div>
  );
}
