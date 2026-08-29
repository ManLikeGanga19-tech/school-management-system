"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}
function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}
function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "right" | "left" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        // .admin-theme so the Prestige CSS vars resolve inside the portal.
        className={cn(
          "admin-theme fixed inset-y-0 z-50 flex h-full w-full flex-col gap-0 bg-[var(--admin-surface)] shadow-2xl outline-none transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out sm:max-w-xl",
          side === "right"
            ? "right-0 border-l border-[var(--admin-border)] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
            : "left-0 border-r border-[var(--admin-border)] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-[var(--admin-muted)] opacity-70 transition hover:bg-[var(--admin-surface-2)] hover:opacity-100 focus:outline-none">
          <XIcon className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 border-b border-[var(--admin-border)] p-6", className)} {...props} />;
}
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-auto flex items-center justify-end gap-2 border-t border-[var(--admin-border)] p-6", className)} {...props} />;
}
function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn("font-serif text-lg font-bold tracking-tight text-[var(--admin-ink)]", className)} {...props} />;
}
function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn("text-sm text-[var(--admin-muted)]", className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
