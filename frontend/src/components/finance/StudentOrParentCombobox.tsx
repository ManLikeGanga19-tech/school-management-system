"use client";

/**
 * StudentOrParentCombobox
 *
 * Search-and-pick combobox that returns either a STUDENT or a PARENT.
 * Used by the Record Payment view so the secretary can land on the right
 * student directly, OR pick a parent and see all their linked children
 * in one panel (multi-child households are a daily case).
 *
 * Options carry a kind tag; selecting one yields { kind, id }. Picking a
 * parent with exactly one child resolves to the same per-student panel as
 * picking the student directly — the panel collapses to single-child mode
 * automatically.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronsUpDown, GraduationCap, Search, User, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Phase O — applicant = prospective enrollment (interview stage), no SIS
// student yet, addressed by enrollment_id via a separate endpoint family.
export type PickedKind = "student" | "parent" | "applicant";

export type PickedTarget = {
  kind: PickedKind;
  id: string;
};

export type StudentOrParentOption = {
  kind: PickedKind;
  id: string;
  label: string;
  sublabel?: string;
};

type Props = {
  options: StudentOrParentOption[];
  value: PickedTarget | null;
  onChange: (value: PickedTarget | null) => void;
  placeholder?: string;
  disabled?: boolean;
};

function optionKey(o: StudentOrParentOption): string {
  return `${o.kind}:${o.id}`;
}

export function StudentOrParentCombobox({
  options,
  value,
  onChange,
  placeholder = "Search student or parent by name…",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  const valueKey = value ? `${value.kind}:${value.id}` : "";
  const selected = options.find((o) => optionKey(o) === valueKey) ?? null;

  const displayLabel = selected ? selected.label : placeholder;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal text-left h-9 px-3"
        >
          <span className={cn("flex items-center gap-1.5 truncate", !selected && "text-muted-foreground")}>
            {selected?.kind === "parent" ? (
              <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            ) : selected?.kind === "student" ? (
              <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            ) : selected?.kind === "applicant" ? (
              <GraduationCap className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            ) : null}
            <span className="truncate">{displayLabel}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-md border bg-white shadow-md"
        >
          <div className="flex items-center border-b px-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, admission no, or phone…"
              className="h-9 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-400">
                No matches.
              </p>
            )}
            {filtered.map((opt) => {
              const key = optionKey(opt);
              const isSelected = key === valueKey;
              return (
                <button
                  key={key}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-sm hover:bg-slate-50",
                    isSelected && "bg-blue-50"
                  )}
                  onClick={() => {
                    onChange({ kind: opt.kind, id: opt.id });
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      isSelected ? "text-blue-600" : "opacity-0"
                    )}
                  />
                  {opt.kind === "parent" ? (
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500" />
                  ) : opt.kind === "applicant" ? (
                    <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                  )}
                  <span className="flex flex-col items-start text-left">
                    <span className={cn("font-medium flex items-center gap-1.5", isSelected && "text-blue-700")}>
                      {opt.label}
                      {opt.kind === "applicant" && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-800 ring-1 ring-amber-200">
                          Applicant
                        </span>
                      )}
                    </span>
                    {opt.sublabel && (
                      <span className="text-xs text-slate-400">{opt.sublabel}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
