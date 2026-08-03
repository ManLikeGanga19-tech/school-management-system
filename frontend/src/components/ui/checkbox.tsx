"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type CheckboxProps = {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** Optional accent (e.g. the tenant brand colour) for the checked state. */
  accentColor?: string;
  "aria-label"?: string;
};

/**
 * Minimal controlled checkbox — no Radix dependency. Renders as an accessible
 * button with role="checkbox" so it works with keyboard and screen readers.
 */
export function Checkbox({
  id,
  checked,
  onCheckedChange,
  disabled,
  className,
  accentColor,
  ...aria
}: CheckboxProps) {
  const accentStyle =
    checked && accentColor
      ? { backgroundColor: accentColor, borderColor: accentColor }
      : undefined;

  return (
    <button
      type="button"
      role="checkbox"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      style={accentStyle}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "bg-primary border-primary text-primary-foreground"
          : "bg-background border-input hover:border-primary/50",
        className
      )}
      {...aria}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  );
}
