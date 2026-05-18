"use client";

import Link from "next/link";
import Image from "next/image";
import { MarketingNavbar } from "./MarketingNavbar";
import { MarketingFooter } from "./MarketingFooter";
import { TrustBar } from "./TrustBar";
import {
  ShieldCheck,
  PlayCircle,
  Star,
  CircleX,
  CircleCheckBig,
  BookOpenCheck,
  Wallet,
  Users,
  ClipboardList,
  Zap,
  Shield,
  BarChart3,
  LayoutGrid,
  Banknote,
  Camera,
  Check,
  Info,
  CheckCircle2,
} from "lucide-react";

const features = [
  { icon: BookOpenCheck, title: "CBC Engine", desc: "Automated formative grading per KICD standards.", bg: "bg-teal-accent", color: "text-deep-teal" },
  { icon: Wallet, title: "Fee Tracking", desc: "Receipt scanning and M-Pesa matching in real time.", bg: "bg-[#d1fae5]", color: "text-forest-green" },
  { icon: Users, title: "Parent Portal", desc: "Real-time grades and fee balances delivered instantly.", bg: "bg-light-sand", color: "text-amber-brown" },
  { icon: ClipboardList, title: "Assessments", desc: "Digital rubric entry and auto-report generation.", bg: "bg-teal-accent", color: "text-deep-teal" },
  { icon: Zap, title: "Support Flags", desc: "Auto-identified alerts for students needing extra help.", bg: "bg-[#fee2e2]", color: "text-brand-primary" },
  { icon: Shield, title: "Compliance", desc: "Tamper-proof audit logs and data protection.", bg: "bg-page-bg", color: "text-muted-text" },
];

export function PublicSite({
  adminHost = "admin.shulehq.co.ke",
  tenantBaseHost = "shulehq.co.ke",
}: {
  adminHost?: string;
  tenantBaseHost?: string;
}) {
  return (
    <>
    <MarketingNavbar />
    <div className="bg-page-bg">
      {/* HERO */}
      <section className="pt-32 pb-20 md:pt-48 md:pb-32 px-4 shadow-[inset_0_-40px_80px_rgba(15,23,42,0.03)] overflow-hidden bg-hero-gradient">
        <div className="max-w-7xl mx-auto text-center">
          <span className="ds-badge bg-light-sand text-deep-teal mb-8">Built for Kenya's CBC Curriculum</span>

          <h1 className="text-5xl md:text-7xl font-bold text-dark-navy tracking-tight leading-[1.1] mb-8 font-display">
            The School That <br className="hidden md:block" />
            <span className="text-brand-primary italic">Runs Itself</span>
          </h1>

          <p className="max-w-2xl mx-auto text-lg md:text-xl text-muted-text leading-relaxed mb-10 font-normal">
            ShuleHQ automates fees, CBC assessments, staff management, and parent communication — so your school can focus on what matters: teaching children.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link href="/demo" className="btn-primary text-lg px-12 py-5 shadow-2xl shadow-brand-primary/20">
              Request a Free Demo
            </Link>
            <a
              href="mailto:support@shulehq.co.ke"
              className="btn-secondary text-lg flex items-center justify-center gap-2"
            >
              <PlayCircle className="w-5 h-5" />
              Talk to Us
            </a>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-6 text-[11px] font-semibold text-muted-text uppercase tracking-[0.2em] mb-20">
            <span>Trusted by growing Kenyan schools</span>
            <span className="hidden md:block opacity-30">•</span>
            <span>CBC-ready from day one</span>
            <span className="hidden md:block opacity-30">•</span>
            <div className="flex gap-1 text-amber-brown">
              {[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 fill-current" />)}
            </div>
          </div>

          {/* Dashboard preview */}
          <div className="relative mx-auto max-w-5xl group">
            <div className="absolute -inset-4 bg-brand-primary/5 rounded-[3rem] blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative ds-card border-brand-border/40 overflow-hidden aspect-[16/10] bg-white">
              <Image
                src="/screenshots/Hero.jpg"
                alt="ShuleHQ director dashboard — CBC analytics and fee overview"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 1024px"
                className="object-cover object-top"
              />
            </div>
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <TrustBar />

      {/* PROBLEM / SOLUTION */}
      <section className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 bg-white rounded-[2rem] border border-brand-border overflow-hidden shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="p-8 md:p-16 bg-warm-cream border-r border-brand-border">
              <h2 className="text-3xl font-bold mb-10 text-dark-navy tracking-tight font-display">Manual school management is holding you back.</h2>
              <ul className="space-y-8">
                {[
                  { t: "Chasing fee payments manually every term", d: "Endless phone calls and late nights reconciling receipts." },
                  { t: "CBC report cards filled in by hand at 11pm", d: "Teachers spending hours on paperwork instead of planning lessons." },
                  { t: "No visibility on student performance trends", d: "Realizing a learner needs support only after the term is over." },
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-4">
                    <div className="text-brand-primary mt-1"><CircleX className="w-6 h-6" /></div>
                    <div>
                      <p className="font-bold text-dark-navy text-lg leading-snug">{item.t}</p>
                      <p className="text-muted-text text-base leading-relaxed font-normal">{item.d}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-8 md:p-16">
              <h2 className="text-3xl font-bold mb-10 text-brand-primary tracking-tight font-display">ShuleHQ changes everything.</h2>
              <ul className="space-y-8">
                {[
                  { t: "Automated invoices & M-Pesa tracking", d: "Real-time balances that reconcile themselves as parents pay." },
                  { t: "One-click CBC Assessment Engine", d: "Automatic generation of KICD-standard report cards." },
                  { t: "Intelligent Learning Flags", d: "Our system identifies students needing extra support based on actual progress." },
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-4">
                    <div className="text-forest-green mt-1"><CircleCheckBig className="w-6 h-6" /></div>
                    <div>
                      <p className="font-bold text-dark-navy text-lg leading-snug">{item.t}</p>
                      <p className="text-muted-text text-base leading-relaxed font-normal">{item.d}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES GRID */}
      <section id="features" className="py-24 px-4 bg-warm-cream">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="label-caps text-brand-primary mb-4 block">Platform Features</span>
            <h2 className="text-4xl font-bold text-dark-navy mb-4 tracking-tight font-display">Built for Kenya. Optimized for you.</h2>
            <p className="text-muted-text text-lg max-w-2xl mx-auto font-normal">A complete ecosystem that simplifies administration and empowers educators.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <div key={i} className="ds-card p-8 hover:-translate-y-1 transition-all group">
                <div className={`w-14 h-14 ${f.bg} rounded-xl flex items-center justify-center ${f.color} mb-6 transition-transform group-hover:scale-110 shadow-sm border border-brand-border/20`}>
                  <f.icon size={28} />
                </div>
                <h3 className="font-bold text-dark-navy text-lg mb-3 tracking-tight font-display">{f.title}</h3>
                <p className="text-muted-text text-[15px] leading-relaxed font-normal">{f.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-16">
            <Link href="/features" className="text-brand-primary font-bold hover:underline inline-flex items-center gap-2 group">
              See all features <ShieldCheck className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* CBC SPOTLIGHT */}
      <section className="py-24 px-4 bg-dark-gradient text-white overflow-hidden relative">
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="flex flex-col lg:flex-row items-center gap-20">
            <div className="lg:w-1/2">
              <div className="bg-white/10 backdrop-blur-xl rounded-[2rem] p-4 border border-white/10 shadow-2xl overflow-hidden aspect-video relative group">
                <div className="relative w-full h-full rounded-2xl overflow-hidden">
                  <Image
                    src="/screenshots/cbc.jpg"
                    alt="ShuleHQ CBC analytics dashboard"
                    fill
                    sizes="(max-width: 1024px) 100vw, 600px"
                    className="object-cover"
                  />
                </div>
              </div>
            </div>
            <div className="lg:w-1/2">
              <span className="ds-badge bg-white/10 text-white border-white/20 mb-8">CBC Core Engine</span>
              <h2 className="text-4xl md:text-5xl font-bold mb-8 leading-tight tracking-tight font-display">Built ground-up for the National Assessment standard.</h2>
              <ul className="space-y-10">
                {[
                  { Icon: LayoutGrid, t: "Digital Observation Log", d: "Track strands and sub-strands on any device, fully aligned with KICD modules." },
                  { Icon: BarChart3, t: "Stream Distribution Reports", d: "Instantly visualize the distribution of EE to BE performance levels across your school." },
                  { Icon: Zap, t: "Early Warning Tags", d: "Automatically flag students needing support based on real-time assessment data trends." },
                ].map(({ Icon, t, d }, i) => (
                  <li key={i} className="flex items-start gap-6 group">
                    <div className="bg-white/10 p-3 rounded-xl text-brand-primary flex-shrink-0 group-hover:bg-brand-primary group-hover:text-white transition-colors">
                      <Icon size={24} />
                    </div>
                    <div>
                      <p className="font-bold text-xl mb-2 text-white">{t}</p>
                      <p className="text-warm-cream/70 text-lg leading-relaxed font-normal">{d}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/features" className="btn-dark-section mt-12 inline-flex items-center gap-3 px-10 py-5">
                Explore CBC Features <ShieldCheck size={20} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FINANCE SECTION */}
      <section className="py-32 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <span className="label-caps text-amber-brown mb-4 block">Financial Management</span>
            <h2 className="text-4xl md:text-5xl font-bold text-dark-navy mb-6 tracking-tight font-display">
              Record every payment. <br /> Verify every receipt.
            </h2>
            <p className="text-muted-text text-lg max-w-2xl mx-auto font-normal">
              Automated M-Pesa integration and physical receipt scanning to eliminate fee disputes and ensure transparency.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 mb-24 text-center">
            {[
              { n: "1", Icon: Banknote, bg: "bg-teal-accent/50 text-deep-teal border-teal-accent", t: "School collects fee", d: "Continue collecting however you do — cash, M-Pesa, bank, or cheque.", rot: "group-hover:rotate-6" },
              { n: "2", Icon: Camera, bg: "bg-brand-primary text-white shadow-2xl shadow-brand-primary/20", t: "Secretary scans receipt", d: "Use any phone to photograph physical receipts for instant recording.", rot: "group-hover:-rotate-6" },
              { n: "3", Icon: ShieldCheck, bg: "bg-teal-accent/50 text-deep-teal border-teal-accent", t: "Balances update", d: "Ledgers update instantly. Parents can verify receipts via our secure portal.", rot: "group-hover:rotate-6" },
            ].map(({ n, Icon, bg, t, d, rot }) => (
              <div key={n} className="p-8 group relative ds-card border-none shadow-none">
                <div className="text-page-bg text-9xl font-bold absolute -z-10 opacity-30 transform -translate-x-12 -translate-y-4 transition-transform group-hover:scale-110">{n}</div>
                <div className={`w-20 h-20 ${bg} rounded-2xl flex items-center justify-center mx-auto mb-8 border border-teal-accent transition-transform ${rot}`}>
                  <Icon size={36} />
                </div>
                <h4 className="font-bold text-2xl mb-4 text-dark-navy tracking-tight font-display">{t}</h4>
                <p className="text-muted-text leading-relaxed font-medium">{d}</p>
              </div>
            ))}
          </div>

          <div className="ds-card bg-warm-cream/50 p-10 md:p-16 overflow-hidden relative border-brand-border">
            <div className="flex flex-col md:flex-row items-center gap-16 relative z-10">
              <div className="md:w-1/2">
                <h3 className="text-4xl font-bold mb-8 text-dark-navy tracking-tight font-display">Built for Kenyan offices.</h3>
                <p className="text-muted-text text-lg mb-10 leading-relaxed font-normal">
                  Every physical payment becomes a verifiable digital record. Eliminate disputes by providing a single source of truth for both administration and parents.
                </p>
                <ul className="space-y-6">
                  {["M-Pesa confirmation code matching", "One-click student balance statements"].map((item, i) => (
                    <li key={i} className="flex items-center gap-4 group">
                      <div className="bg-teal-accent p-2 rounded-lg text-deep-teal group-hover:bg-deep-teal group-hover:text-white transition-all">
                        <Check size={20} />
                      </div>
                      <span className="text-lg font-bold text-dark-navy tracking-tight">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-12 p-6 rounded-2xl border border-brand-border bg-white shadow-sm flex gap-4">
                  <div className="shrink-0 w-10 h-10 bg-light-sand rounded-xl flex items-center justify-center text-amber-brown">
                    <Info size={24} />
                  </div>
                  <p className="text-sm text-muted-text font-medium leading-relaxed">
                    <strong className="text-dark-navy">Transparency first.</strong> ShuleHQ records the flow. Your school maintains full control of the actual banking accounts.
                  </p>
                </div>
              </div>
              <div className="md:w-1/2">
                <div className="relative bg-page-bg rounded-[2rem] aspect-[4/3] border border-brand-border overflow-hidden shadow-inner group">
                  <Image
                    src="/screenshots/finance.jpg"
                    alt="ShuleHQ receipt scanning and payment recording"
                    fill
                    sizes="(max-width: 768px) 100vw, 500px"
                    className="object-cover group-hover:scale-105 transition-transform"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIAL */}
      <section className="py-24 px-4 bg-page-bg">
        <div className="max-w-4xl mx-auto ds-card p-12 md:p-20 text-center relative border-brand-border shadow-none bg-white">
          <Star className="text-amber-brown absolute top-12 left-12 opacity-20" size={48} />
          <p className="text-2xl md:text-3xl italic text-dark-navy mb-12 font-medium leading-relaxed">
            "Before ShuleHQ, my secretary spent two full days every term just reconciling M-Pesa codes with our fee ledger. Now she finishes it before morning tea. The time we've saved alone is worth every shilling."
          </p>
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-light-sand rounded-full mb-6 border-2 border-white shadow-sm flex items-center justify-center font-bold text-amber-brown">DM</div>
            <p className="font-bold text-brand-primary text-lg font-display">David Mwangi</p>
            <p className="label-caps text-muted-text mt-1">Director, Sunrise Academy — Nairobi</p>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-32 px-4 bg-white">
        <div className="max-w-7xl mx-auto bg-dark-navy rounded-[3rem] p-12 md:p-24 text-white text-center shadow-2xl relative overflow-hidden border border-white/5">
          <div className="max-w-4xl mx-auto relative z-10">
            <h2 className="text-5xl md:text-6xl font-bold mb-8 tracking-tight leading-[1.1] font-display">
              Join the future of <br /> school management.
            </h2>
            <p className="text-warm-cream/60 text-xl md:text-2xl mb-16 font-normal leading-relaxed">
              Join Kenya's fastest-growing private schools already running smarter with ShuleHQ.
            </p>
            <Link href="/demo" className="btn-dark-section text-2xl px-12 py-6 shadow-2xl">
              Request a Free Demo
            </Link>
          </div>
        </div>
      </section>
    </div>
    <MarketingFooter />
    </>
  );
}
