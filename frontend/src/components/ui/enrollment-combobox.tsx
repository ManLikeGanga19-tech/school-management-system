"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type EnrollmentOption = {
  id: string;
  label: string;
  sublabel?: string;
};

type Props = {
  options: EnrollmentOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allLabel?: string;
  disabled?: boolean;
};

export function EnrollmentCombobox({
  options,
  value,
  onChange,
  placeholder = "Select student…",
  allLabel,
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
        o.sublabel?.toLowerCase().includes(q)
    );
  }, [options, query]);

  const selected = allLabel
    ? value
      ? options.find((o) => o.id === value)
      : null
    : options.find((o) => o.id === value);

  const displayLabel = selected
    ? selected.label
    : allLabel || placeholder;

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
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {displayLabel}
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
              placeholder="Search students…"
              className="h-9 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
            />
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {allLabel && (
              <button
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50",
                  !value && "font-medium text-slate-900"
                )}
                onClick={() => { onChange(""); setOpen(false); }}
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0", value ? "opacity-0" : "text-blue-600")} />
                {allLabel}
              </button>
            )}

            {filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-400">
                No students found.
              </p>
            )}

            {filtered.map((opt) => (
              <button
                key={opt.id}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-sm hover:bg-slate-50",
                  value === opt.id && "bg-blue-50"
                )}
                onClick={() => { onChange(opt.id); setOpen(false); }}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    value === opt.id ? "text-blue-600" : "opacity-0"
                  )}
                />
                <span className="flex flex-col items-start">
                  <span className={cn("font-medium", value === opt.id && "text-blue-700")}>
                    {opt.label}
                  </span>
                  {opt.sublabel && (
                    <span className="text-xs text-slate-400">{opt.sublabel}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
