"use client";

import { useState, useEffect } from "react";
import { ShuleHQLogo } from "@/components/brand/ShuleHQLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

const navLinks = [
  { name: "Features", path: "/features" },
  { name: "Pricing", path: "/pricing" },
  { name: "About", path: "/about" },
  { name: "Blog", path: "/blog" },
];

const DARK_HERO_PATHS = ["/blog", "/careers", "/changelog", "/privacy", "/mpesa-setup", "/cbc-guide", "/help"];

export function MarketingNavbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const isDarkHero = DARK_HERO_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const useLightText = isDarkHero && !isScrolled;

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 w-full z-50 transition-all duration-300 border-b ${
        isScrolled
          ? "bg-page-bg/92 backdrop-blur-[12px] border-brand-border py-4 shadow-sm"
          : isDarkHero
          ? "bg-dark-navy/60 backdrop-blur-[6px] border-white/10 py-6"
          : "bg-transparent border-transparent py-6"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center">
          <Link href="/" className="flex items-center group" aria-label="ShuleHQ home">
            <ShuleHQLogo theme={useLightText ? "dark" : "light"} size={38} className="group-hover:scale-105 transition-transform" />
          </Link>

          <div className="hidden md:flex items-center space-x-10">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.path}
                className={`text-[15px] font-semibold transition-colors tracking-tight ${
                  pathname === link.path
                    ? "text-brand-primary"
                    : useLightText
                    ? "text-white/80 hover:text-white"
                    : "text-muted-text hover:text-dark-navy"
                }`}
              >
                {link.name}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center space-x-6">
            {/* No public sign-in: each school signs in on its own subdomain,
                emailed after onboarding. The site's only CTA is a demo. */}
            <Link href="/demo" className="btn-primary">
              Request a Demo
            </Link>
          </div>

          <button
            className={`md:hidden p-2 hover:bg-white/10 rounded-full transition-colors ${useLightText ? "text-white" : "text-dark-navy"}`}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 w-full bg-page-bg border-b border-brand-border p-6 flex flex-col space-y-6 shadow-xl">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              href={link.path}
              className={`text-lg font-bold transition-colors ${pathname === link.path ? "text-brand-primary" : "text-dark-navy"}`}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {link.name}
            </Link>
          ))}
          <div className="pt-6 border-t border-brand-border flex flex-col space-y-4">
            <Link href="/demo" onClick={() => setIsMobileMenuOpen(false)} className="btn-primary text-center">
              Request a Demo
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
