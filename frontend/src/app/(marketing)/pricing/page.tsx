"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Users2, MessageSquare, Plus, Lock, Users, ClipboardList, Cloud, Globe } from "lucide-react";

const renderValue = (val: string | boolean) => {
  if (typeof val === "boolean") {
    return val ? <Check className="w-5 h-5 mx-auto text-forest-green" /> : <span className="text-brand-border">—</span>;
  }
  return <span className="font-bold text-dark-navy tracking-tight">{val}</span>;
};

const comparisonData = [
  {
    category: "Student Registry",
    features: [
      { name: "Digital Student Profiles", starter: true, growth: true, enterprise: true },
      { name: "Daily Attendance Tracking", starter: true, growth: true, enterprise: true },
    ],
  },
  {
    category: "Academics & CBC",
    features: [
      { name: "CBC Assessment Engine", starter: true, growth: true, enterprise: true },
      { name: "Learner Support Flags", starter: false, growth: true, enterprise: true },
      { name: "Class Performance Analytics", starter: false, growth: true, enterprise: true },
    ],
  },
  {
    category: "Finance & Fees",
    features: [
      { name: "Receipt scanning (phone camera)", starter: true, growth: true, enterprise: true },
      { name: "M-Pesa verification & matching", starter: true, growth: true, enterprise: true },
      { name: "Cash receipt recording", starter: true, growth: true, enterprise: true },
      { name: "Parent verification portal", starter: true, growth: true, enterprise: true },
      { name: "Monthly SMS credits included", starter: "500", growth: "2,000", enterprise: "Custom" },
      { name: "Additional SMS top-ups", starter: true, growth: true, enterprise: true },
    ],
  },
];

const faqs = [
  { q: "Does ShuleHQ collect fees for us?", a: "No. ShuleHQ never touches your school's money. You collect fees however you already do — cash desk, M-Pesa paybill, bank. We record it, verify it, and give parents a digital trail." },
  { q: "How does receipt scanning work?", a: "Your secretary opens ShuleHQ on any phone, taps 'Scan Receipt', and photographs the payment receipt. ShuleHQ extracts the amount, matches it to the student, and updates their balance instantly." },
  { q: "What do SMS credits cover?", a: "SMS credits are used for fee balance reminders, CBC report card alerts, and school announcements. You can top up more credits at any time from your dashboard." },
  { q: "Is my school's data safe?", a: "Absolutely. All data is encrypted. We perform automated nightly backups and use military-grade security for child data protection." },
];

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(true);

  return (
    <div className="bg-page-bg">
      <section className="pt-32 pb-16 px-4 text-center bg-hero-gradient">
        <div className="max-w-7xl mx-auto">
          <span className="ds-badge bg-light-sand text-deep-teal mb-6">Simple Pricing</span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-dark-navy tracking-tight mb-6 leading-tight">
            Pricing that grows <br className="hidden md:block" />{" "}
            <span className="text-brand-primary italic">with your school</span>
          </h1>
          <p className="max-w-xl mx-auto text-lg text-muted-text mb-10 leading-relaxed font-normal">
            Simple, predictable billing. No setup fees, no per-user charges. Choose the plan that matches your student enrollment.
          </p>
          <div className="flex items-center justify-center gap-6 mb-16">
            <span className={`label-caps ${!isAnnual ? "text-brand-primary" : "text-muted-text"}`}>Monthly</span>
            <button
              onClick={() => setIsAnnual(!isAnnual)}
              className={`w-14 h-7 rounded-full relative p-1 flex items-center transition-all ${isAnnual ? "bg-brand-primary" : "bg-brand-border"}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full shadow-lg transform transition-transform ${isAnnual ? "translate-x-7" : "translate-x-0"}`}></div>
            </button>
            <div className="flex items-center gap-3">
              <span className={`label-caps ${isAnnual ? "text-brand-primary" : "text-muted-text"}`}>Annual</span>
              <span className="ds-badge bg-[#d1fae5] text-forest-green">2 Months Free</span>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-24 px-4 bg-page-bg">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="ds-card p-10 flex flex-col hover:border-brand-primary/30 transition-all hover:shadow-xl bg-white">
            <div className="mb-8">
              <h3 className="label-caps text-muted-text mb-2">Starter</h3>
              <p className="text-dark-navy text-sm font-bold tracking-tight">Best for new and small schools</p>
            </div>
            <div className="mb-8">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-dark-navy tracking-tighter">KES {isAnnual ? "45,000" : "4,500"}</span>
                <span className="text-muted-text text-sm font-bold">{isAnnual ? "/yr" : "/mo"}</span>
              </div>
              <p className="label-caps text-brand-primary mt-2">{isAnnual ? "Billed once annually" : "Billed monthly"}</p>
            </div>
            <div className="space-y-4 mb-10 flex-1">
              <p className="text-sm font-bold text-dark-navy mb-2 flex items-center gap-2 tracking-tight">
                <Users2 className="w-4 h-4 text-brand-primary" /> Up to 200 students
              </p>
              <p className="text-sm font-bold text-deep-teal mb-4 flex items-center gap-2 tracking-tight">
                <MessageSquare className="w-4 h-4" /> 500 SMS credits /mo
              </p>
              <ul className="space-y-4 text-sm text-muted-text font-medium">
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Single campus access</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Full CBC Assessment Engine</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Finance & Fee Tracking</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Parent Portal & SMS Alerts</li>
                <li className="flex items-center gap-3 opacity-30 line-through">HR & Leave Management</li>
                <li className="flex items-center gap-3 opacity-30 line-through">Learner Support Flags</li>
              </ul>
            </div>
            <Link href="/demo" className="btn-secondary w-full text-xs label-caps py-4 text-center block">
              Request a Demo
            </Link>
          </div>

          <div className="ds-card border-2 border-brand-primary p-10 flex flex-col shadow-2xl relative lg:scale-105 z-10 bg-white">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-amber-brown text-white text-[10px] font-bold px-4 py-1.5 rounded-full uppercase tracking-[0.2em] shadow-lg">Recommended</div>
            <div className="mb-8">
              <h3 className="label-caps text-brand-primary mb-2">Growth</h3>
              <p className="text-dark-navy text-sm font-bold tracking-tight">Best for growing schools with full staff</p>
            </div>
            <div className="mb-8">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-dark-navy tracking-tighter">KES {isAnnual ? "95,000" : "9,500"}</span>
                <span className="text-muted-text text-sm font-bold">{isAnnual ? "/yr" : "/mo"}</span>
              </div>
              <p className="label-caps text-brand-primary mt-2">{isAnnual ? "Billed once annually" : "Billed monthly"}</p>
            </div>
            <div className="space-y-4 mb-10 flex-1">
              <p className="text-sm font-bold text-dark-navy mb-2 flex items-center gap-2 tracking-tight">
                <Users2 className="w-4 h-4 text-brand-primary" /> Up to 600 students
              </p>
              <p className="text-sm font-bold text-deep-teal mb-4 flex items-center gap-2 tracking-tight">
                <MessageSquare className="w-4 h-4" /> 2,000 SMS credits /mo
              </p>
              <ul className="space-y-4 text-sm text-muted-text font-medium">
                <li className="flex items-center gap-3 font-bold text-dark-navy tracking-tight"><Check className="w-4 h-4 text-forest-green" /> Everything in Starter +</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> HR & Leave Management</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Full CBC Analytics Dashboard</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Learner Support Flags</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Custom Report Card Templates</li>
                <li className="flex items-center gap-3 text-brand-primary font-bold tracking-tight"><Plus className="w-4 h-4" /> Extra SMS top-ups anytime</li>
              </ul>
            </div>
            <Link href="/demo" className="btn-primary w-full text-xs label-caps py-4 shadow-xl shadow-brand-primary/20 text-center block">
              Request a Demo
            </Link>
          </div>

          <div className="ds-card p-10 flex flex-col hover:border-brand-primary/30 transition-all hover:shadow-xl bg-white">
            <div className="mb-8">
              <h3 className="label-caps text-muted-text mb-2">Enterprise</h3>
              <p className="text-dark-navy text-sm font-bold tracking-tight">Best for multi-campus groups</p>
            </div>
            <div className="mb-8">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-dark-navy tracking-tighter">Custom</span>
              </div>
              <p className="label-caps text-muted-text mt-2">Contact for volume pricing</p>
            </div>
            <div className="space-y-4 mb-10 flex-1">
              <p className="text-sm font-bold text-dark-navy mb-4 flex items-center gap-2 tracking-tight">
                <Users2 className="w-4 h-4 text-brand-primary" /> Unlimited students
              </p>
              <ul className="space-y-4 text-sm text-muted-text font-medium">
                <li className="flex items-center gap-3 font-bold text-dark-navy tracking-tight"><Check className="w-4 h-4 text-forest-green" /> Everything in Growth +</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Multi-campus Management</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Dedicated Account Manager</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> Customized Data Migration</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> On-site Staff Training</li>
                <li className="flex items-center gap-3"><Check className="w-4 h-4 text-forest-green" /> SLA & API Access</li>
              </ul>
            </div>
            <Link href="/demo" className="btn-secondary text-center w-full text-xs label-caps py-4">
              Contact Sales
            </Link>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white border-y border-brand-border">
        <div className="max-w-4xl mx-auto overflow-x-auto">
          <h2 className="text-3xl font-bold text-dark-navy text-center mb-16 tracking-tight">Full Feature Comparison</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-brand-border">
                <th className="py-6 px-4 text-left label-caps text-muted-text">Feature</th>
                <th className="py-6 px-4 text-center font-bold text-dark-navy tracking-tight">Starter</th>
                <th className="py-6 px-4 text-center font-bold text-dark-navy tracking-tight">Growth</th>
                <th className="py-6 px-4 text-center font-bold text-dark-navy tracking-tight">Enterprise</th>
              </tr>
            </thead>
            <tbody className="text-sm font-medium">
              {comparisonData.map((section, idx) => (
                <>
                  <tr key={`cat-${idx}`} className="bg-warm-cream/50">
                    <td colSpan={4} className="py-4 px-4 label-caps text-brand-primary">{section.category}</td>
                  </tr>
                  {section.features.map((f, fIdx) => (
                    <tr key={`feat-${idx}-${fIdx}`} className="border-b border-brand-border">
                      <td className="py-5 px-4 text-muted-text font-normal">{f.name}</td>
                      <td className="text-center">{renderValue(f.starter)}</td>
                      <td className="text-center">{renderValue(f.growth)}</td>
                      <td className="text-center">{renderValue(f.enterprise)}</td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="py-24 px-4 bg-warm-cream">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl font-bold text-center text-dark-navy mb-16 tracking-tight">Got Questions?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-white p-10 rounded-[2rem] border border-brand-border shadow-sm hover:shadow-md transition-shadow">
                <h4 className="font-bold text-dark-navy text-lg mb-4 leading-tight tracking-tight">{faq.q}</h4>
                <p className="text-muted-text leading-relaxed font-normal text-base">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-white border-y border-brand-border">
        <div className="max-w-7xl mx-auto text-center">
          <p className="label-caps text-muted-text mb-12">Secure by default</p>
          <div className="flex flex-wrap justify-center items-center gap-12 opacity-30 grayscale">
            <div className="flex items-center gap-3"><Lock className="w-5 h-5" /> <span className="label-caps">Data Encrypted</span></div>
            <div className="flex items-center gap-3"><Users className="w-5 h-5" /> <span className="label-caps">Role-Based Access</span></div>
            <div className="flex items-center gap-3"><ClipboardList className="w-5 h-5" /> <span className="label-caps">Full Audit Log</span></div>
            <div className="flex items-center gap-3"><Cloud className="w-5 h-5" /> <span className="label-caps">Automated Backups</span></div>
            <div className="flex items-center gap-3"><Globe className="w-5 h-5" /> <span className="label-caps">Hosted in Africa</span></div>
          </div>
        </div>
      </section>
    </div>
  );
}
