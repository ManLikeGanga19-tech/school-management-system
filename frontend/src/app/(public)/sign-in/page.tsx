"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowRight, AlertCircle } from "lucide-react";

export default function SignInPage() {
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!clean) {
      setError("Please enter your school's login name.");
      return;
    }
    const host = window.location.hostname;
    const parts = host.split(".");
    const baseDomain = parts.length >= 2 ? parts.slice(-2).join(".") : host;
    window.location.href = `https://${clean}.${baseDomain}/login`;
  };

  return (
    <div className="min-h-screen bg-hero-gradient flex flex-col items-center justify-center px-4 py-32">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-10">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-12 h-12 bg-brand-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-brand-primary/20 group-hover:scale-110 transition-transform">
              <ShieldCheck size={28} />
            </div>
            <span className="text-3xl font-bold tracking-tight text-dark-navy italic font-display">
              Shule<span className="text-brand-primary font-black">HQ</span>
            </span>
          </Link>
        </div>

        <div className="ds-card bg-white p-10 shadow-xl">
          <h1 className="text-2xl font-bold text-dark-navy mb-2 tracking-tight">Sign in to your school</h1>
          <p className="text-muted-text text-sm mb-8 font-normal leading-relaxed">
            Enter your school's login name to access your ShuleHQ dashboard.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block label-caps text-muted-text mb-3">School login name</label>
              <div className="flex items-center border border-brand-border rounded-xl overflow-hidden focus-within:border-brand-primary focus-within:ring-4 focus-within:ring-brand-primary/10 transition-all">
                <span className="px-4 py-4 bg-muted-warm text-muted-text text-sm font-bold border-r border-brand-border whitespace-nowrap">
                  shulehq.co.ke/
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => { setSlug(e.target.value); setError(""); }}
                  placeholder="your-school"
                  className="flex-1 px-4 py-4 outline-none font-bold text-dark-navy placeholder:font-normal placeholder:text-muted-text/40 bg-white"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {error && (
                <p className="mt-2 text-sm text-brand-primary flex items-center gap-2 font-medium">
                  <AlertCircle size={14} /> {error}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-text font-normal">
                e.g.{" "}
                <span className="font-bold text-dark-navy">greenhill-academy</span> or{" "}
                <span className="font-bold text-dark-navy">st-marys</span>
              </p>
            </div>

            <button type="submit" className="btn-primary w-full py-4 text-base gap-3">
              Continue <ArrowRight size={18} />
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-brand-border text-center space-y-3">
            <p className="text-sm text-muted-text font-normal">
              Not sure of your school's login name?{" "}
              <a href="mailto:support@shulehq.co.ke" className="text-brand-primary font-bold hover:underline">
                Contact support
              </a>
            </p>
            <p className="text-sm text-muted-text font-normal">
              Don't have an account?{" "}
              <Link href="/demo" className="text-brand-primary font-bold hover:underline">
                Request a demo
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-muted-text mt-8 font-medium">
          Are you a ShuleHQ administrator?{" "}
          <a href="https://admin.shulehq.co.ke" className="text-brand-primary font-bold hover:underline">
            Admin login →
          </a>
        </p>
      </div>
    </div>
  );
}
