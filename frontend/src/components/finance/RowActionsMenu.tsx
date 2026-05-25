"use client";

import * as React from "react";
import { MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type RowAction = {
  /** Stable key for the React list. */
  key: string;
  /** Visible label inside the menu. */
  label: string;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /** Fired when the item is chosen. */
  onSelect: () => void;
  /** Render in destructive (red) styling — e.g. delete. */
  destructive?: boolean;
  /** Disable the item without removing it. */
  disabled?: boolean;
  /** Omit the item entirely (e.g. permission-gated). */
  hidden?: boolean;
  /** Draw a separator above this item. */
  separatorBefore?: boolean;
};

/**
 * A constant three-vertical-dot (kebab) actions menu for table rows. Keeps the
 * Actions column to a single icon so rows never need horizontal scrolling to
 * reach secondary actions. Shared across every finance table for a uniform UX.
 *
 * Stops click propagation so it can sit inside clickable rows.
 */
export function RowActionsMenu({
  actions,
  ariaLabel = "Row actions",
  align = "end",
}: {
  actions: RowAction[];
  ariaLabel?: string;
  align?: "start" | "center" | "end";
}) {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-500 hover:text-slate-900"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="w-44"
        onClick={(e) => e.stopPropagation()}
      >
        {visible.map((a) => (
          <React.Fragment key={a.key}>
            {a.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant={a.destructive ? "destructive" : "default"}
              disabled={a.disabled}
              onSelect={(e) => {
                e.preventDefault();
                a.onSelect();
              }}
            >
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
