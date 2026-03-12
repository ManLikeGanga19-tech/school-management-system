"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, LogOut, Menu, School, X } from "lucide-react";

import { useProspectSession } from "@/components/marketing/ProspectSessionProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";

type NavItem = {
  href: string;
  label: string;
};

function initialsFor(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return "SH";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "SH";
}

export function PublicNavbar({
  navItems,
  createAccessHref = "/create-access",
  signInHref = "/sign-in",
}: {
  navItems: NavItem[];
  createAccessHref?: string;
  signInHref?: string;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { account, setAccount } = useProspectSession();

  const accountInitials = useMemo(
    () => initialsFor(account?.full_name || account?.email || ""),
    [account]
  );

  async function handleLogout() {
    await fetch("/api/prospect/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);

    setAccount(null);
    setMobileNavOpen(false);
    toast.success("Signed out.");
    window.location.assign("/");
  }

  return (
    <>
      <header className="hero-rise flex items-center justify-between rounded-[2rem] border border-white/60 bg-white/70 px-4 py-4 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:px-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link href="/" className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
            <School className="size-5" />
          </Link>
          <div className="min-w-0">
            <Link href="/" className="block truncate text-base font-semibold tracking-tight sm:text-lg">
              ShuleHQ
            </Link>
            <p className="hidden text-sm text-slate-600 md:block">
              Public onboarding for institution rollout, implementation planning, and tenant activation.
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-5 lg:flex">
          <nav className="flex items-center gap-5 text-sm text-slate-600">
            {navItems.map((item) => (
              <a key={item.href} className="transition hover:text-slate-950" href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          {account ? (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-11 rounded-full border-slate-300 bg-white/90 px-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                      {accountInitials}
                    </span>
                    <span className="hidden max-w-32 truncate text-sm font-medium text-slate-900 xl:block">
                      {account.full_name}
                    </span>
                    <ChevronDown className="size-4 text-slate-500" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 rounded-2xl border-slate-200 p-2">
                  <DropdownMenuLabel className="space-y-1 px-3 py-2">
                    <div className="text-sm font-semibold text-slate-950">{account.full_name}</div>
                    <div className="truncate text-xs font-normal text-slate-500">{account.email}</div>
                    <div className="truncate text-xs font-normal text-slate-500">{account.organization_name}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="rounded-xl px-3 py-2">
                    <Link href="/#engage">Open request desk</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button type="button" variant="outline" className="rounded-full border-slate-300 bg-white/90" onClick={handleLogout}>
                <LogOut className="size-4" />
                Log out
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" className="rounded-full border-slate-300 bg-white/90">
                <Link href={signInHref}>Sign in</Link>
              </Button>
              <Button asChild className="rounded-full bg-slate-950 text-white hover:bg-slate-800">
                <Link href={createAccessHref}>Create access</Link>
              </Button>
            </div>
          )}
        </div>

        <Button
          type="button"
          size="icon"
          variant="outline"
          className="rounded-full border-slate-300 bg-white/90 lg:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </Button>
      </header>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          showCloseButton={false}
          className="left-0 top-0 h-dvh w-[min(22rem,86vw)] max-w-none translate-x-0 translate-y-0 rounded-none border-r border-slate-200 bg-[#fbf8f2] p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-none"
        >
          <DialogTitle className="sr-only">Mobile navigation</DialogTitle>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <School className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">ShuleHQ</p>
                  <p className="text-xs text-slate-500">Public onboarding</p>
                </div>
              </div>
              <DialogClose asChild>
                <Button type="button" size="icon" variant="ghost" className="rounded-full" aria-label="Close navigation">
                  <X className="size-5" />
                </Button>
              </DialogClose>
            </div>

            <nav className="flex flex-1 flex-col px-5 py-6">
              <div className="space-y-2">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileNavOpen(false)}
                    className="block rounded-2xl border border-transparent px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-200 hover:bg-white"
                  >
                    {item.label}
                  </a>
                ))}
              </div>

              {account ? (
                <div className="mt-8 space-y-4 rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                      {accountInitials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-950">{account.full_name}</p>
                      <p className="truncate text-xs text-slate-500">{account.email}</p>
                    </div>
                  </div>
                  <Button asChild variant="outline" className="w-full rounded-full">
                    <Link href="/#engage" onClick={() => setMobileNavOpen(false)}>
                      Open request desk
                    </Link>
                  </Button>
                  <Button type="button" className="w-full rounded-full bg-slate-950 text-white hover:bg-slate-800" onClick={handleLogout}>
                    <LogOut className="size-4" />
                    Log out
                  </Button>
                </div>
              ) : (
                <div className="mt-8 space-y-3 rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Prospect access</p>
                  <Button asChild variant="outline" className="w-full rounded-full">
                    <Link href={signInHref} onClick={() => setMobileNavOpen(false)}>
                      Sign in
                    </Link>
                  </Button>
                  <Button asChild className="w-full rounded-full bg-slate-950 text-white hover:bg-slate-800">
                    <Link href={createAccessHref} onClick={() => setMobileNavOpen(false)}>
                      Create access
                    </Link>
                  </Button>
                </div>
              )}
            </nav>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
