"use client";

import Link from "next/link";
import {
  ShieldCheck,
  Check,
  ArrowRight,
  CalendarCheck,
  Briefcase,
  MessageSquare,
  Flag,
  Lock,
  History,
} from "lucide-react";
import { CbcMockup, FinanceMockup, ParentMockup, AnalyticsMockup } from "@/components/marketing/FeatureMockup";

const modules = [
  { id: "cbc", name: "CBC Engine" },
  { id: "finance", name: "Finance & M-Pesa" },
  { id: "portal", name: "Parent Portal" },
  { id: "attendance", name: "Attendance" },
  { id: "hr", name: "HR & Staff" },
  { id: "sms", name: "SMS Notifications" },
  { id: "learner-support", name: "Learner Support" },
  { id: "rbac", name: "Multi-role Access" },
  { id: "audit", name: "Audit & Compliance" },
];

export default function FeaturesPage() {
  return (
    <div className="bg-page-bg">
      <section className="pt-32 pb-20 bg-hero-gradient border-b border-brand-border">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <span className="ds-badge bg-light-sand text-deep-teal mb-6">Built for Kenya</span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-dark-navy tracking-tight mb-6 leading-tight">
            Every tool your school needs <br className="hidden md:block" />{" "}
            <span className="text-brand-primary italic">under one roof</span>
          </h1>
          <p className="max-w-2xl mx-auto text-lg text-muted-text mb-10 leading-relaxed font-normal">
            From high-level director analytics to granular classroom grading, ShuleHQ is built to handle the complexities of the modern Kenyan school.
          </p>
          <Link href="/demo" className="btn-primary px-12 py-5 text-xl shadow-2xl">
            Request a Free Demo
          </Link>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="flex flex-col lg:flex-row gap-16">
          <aside className="hidden lg:block w-72 shrink-0">
            <nav className="sticky top-32 space-y-1">
              <p className="label-caps text-muted-text mb-6">Modules</p>
              <ul className="space-y-2">
                {modules.map((m) => (
                  <li key={m.id}>
                    <a
                      href={`#${m.id}`}
                      className="block py-3 px-4 rounded-xl text-muted-text font-bold hover:bg-white hover:text-brand-primary transition-all border border-transparent hover:border-brand-border shadow-sm hover:shadow-md"
                    >
                      {m.name}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <main className="flex-1 space-y-40">
            <section id="cbc" className="scroll-mt-32">
              <div className="flex flex-col md:flex-row items-center gap-16">
                <div className="md:w-1/2">
                  <div className="ds-badge bg-teal-accent text-deep-teal mb-6">
                    <ShieldCheck className="w-3 h-3" /> Core Engine
                  </div>
                  <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight leading-tight">CBC Assessment Engine</h2>
                  <p className="text-muted-text text-lg mb-8 leading-relaxed font-normal">
                    Formative & summative grading aligned to KICD standards. ShuleHQ is the only ERP built specifically for the nuances of the Competency-Based Curriculum.
                  </p>
                  <ul className="space-y-5 mb-10">
                    {["Automated EE/ME/AE/BE calculation", "Formative strand-level tracking", "Summative end-of-term evaluations", "Learner Support Flag triggers"].map((item, i) => (
                      <li key={i} className="flex items-center gap-4 text-dark-navy font-bold tracking-tight">
                        <div className="bg-teal-accent p-1 rounded-lg text-deep-teal"><Check className="w-4 h-4 shadow-sm" /></div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/cbc-guide" className="text-brand-primary font-bold flex items-center gap-2 group label-caps">
                    Explore CBC Framework <ArrowRight size={16} className="transition-transform group-hover:translate-x-2" />
                  </Link>
                </div>
                <div className="md:w-1/2"><CbcMockup /></div>
              </div>
            </section>

            <section id="finance" className="scroll-mt-32">
              <div className="flex flex-col md:flex-row-reverse items-center gap-16">
                <div className="md:w-1/2">
                  <div className="ds-badge bg-light-sand text-amber-brown mb-6">Financial Integrity</div>
                  <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight leading-tight">Finance & Fee Tracking</h2>
                  <p className="text-muted-text text-lg mb-8 leading-relaxed font-normal">
                    Record payments, scan receipts, and track every student's balance — however your school collects fees. Whether it's cash, M-Pesa, bank transfer, or cheque, ShuleHQ keeps a tamper-proof ledger.
                  </p>
                  <ul className="space-y-5 mb-10">
                    {["Record cash, M-Pesa, bank & cheque payments", "M-Pesa STK push — payment comes to parent's phone", "QR-verified digital receipts (PDF + 80mm thermal)", "Parent portal — search payment by phone or M-Pesa code"].map((item, i) => (
                      <li key={i} className="flex items-center gap-4 text-dark-navy font-bold tracking-tight">
                        <div className="bg-teal-accent p-1 rounded-lg text-deep-teal"><Check className="w-4 h-4" /></div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:w-1/2"><FinanceMockup /></div>
              </div>
            </section>

            <section id="portal" className="scroll-mt-32">
              <div className="flex flex-col md:flex-row items-center gap-16">
                <div className="md:w-1/2">
                  <h2 className="text-3xl md:text-4xl font-bold text-dark-navy mb-6 tracking-tight">Parent Portal</h2>
                  <p className="text-muted-text text-lg mb-8 leading-relaxed font-normal">
                    Give parents real-time visibility into their child's education and financial status without physical meetings or phone calls.
                  </p>
                  <ul className="space-y-4 mb-8">
                    {["Mobile-friendly CBC progress reports", "Instant access to fee balance & payment history", "M-Pesa STK push — pay directly from the portal", "Download PDF receipts for any payment"].map((item, i) => (
                      <li key={i} className="flex items-center gap-3 text-dark-navy font-bold tracking-tight">
                        <Check className="w-5 h-5 text-brand-primary" /> <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:w-1/2"><ParentMockup /></div>
              </div>
            </section>

            <section id="attendance" className="scroll-mt-32">
              <div className="flex flex-col md:flex-row-reverse items-center gap-16">
                <div className="md:w-1/2">
                  <div className="ds-badge bg-teal-accent text-deep-teal mb-6"><CalendarCheck className="w-3 h-3" /> Attendance</div>
                  <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight leading-tight">Attendance Tracking</h2>
                  <p className="text-muted-text text-lg mb-8 leading-relaxed font-normal">
                    Digital class registers replace paper roll calls. Teachers mark attendance per class and term. Patterns are visible at a glance — chronic absences are flagged automatically.
                  </p>
                  <ul className="space-y-5 mb-10">
                    {["Per-class daily registers", "Term-level attendance summaries", "Automatic parent SMS alerts on absence", "Linked to CBC learner support flags"].map((item, i) => (
                      <li key={i} className="flex items-center gap-4 text-dark-navy font-bold tracking-tight">
                        <div className="bg-teal-accent p-1 rounded-lg text-deep-teal"><Check className="w-4 h-4" /></div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:w-1/2"><AnalyticsMockup /></div>
              </div>
            </section>

            <section id="hr" className="scroll-mt-32">
              <div className="flex flex-col md:flex-row items-center gap-16">
                <div className="md:w-1/2">
                  <div className="ds-badge bg-light-sand text-amber-brown mb-6"><Briefcase className="w-3 h-3" /> HR & Staff</div>
                  <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight leading-tight">HR & Staff Management</h2>
                  <p className="text-muted-text text-lg mb-8 leading-relaxed font-normal">
                    Manage your full teaching and support staff from one place. Track contracts, payroll references, leave requests, and duty assignments with role-based access so each staff member only sees what they need.
                  </p>
                  <ul className="space-y-5 mb-10">
                    {["Staff profiles, roles & departments", "Leave request & approval workflow", "Payroll reference records", "Class & subject assignment management"].map((item, i) => (
                      <li key={i} className="flex items-center gap-4 text-dark-navy font-bold tracking-tight">
                        <div className="bg-teal-accent p-1 rounded-lg text-deep-teal"><Check className="w-4 h-4" /></div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:w-1/2 ds-card bg-muted-warm aspect-video flex items-center justify-center p-12 text-center border-brand-border shadow-inner">
                  <Briefcase size={48} className="text-brand-border" />
                </div>
              </div>
            </section>

            <section id="sms" className="scroll-mt-32">
              <div className="flex flex-col md:flex-row-reverse items-center gap-16">
                <div className="md:w-1/2">
                  <div className="ds-badge bg-teal-accent text-deep-teal mb-6"><MessageSquare className="w-3 h-3" /> SMS</div>
                  <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight leading-tight">SMS Notifications</h2>
                  <p className="text-muted-text text-lg mb-8 leading-relaxed font-normal">
                    Reach every parent instantly via SMS — no smartphones required. Send fee reminders, report card alerts, event notices, and absence notifications directly from ShuleHQ using Africa's Talking.
                  </p>
                  <ul className="space-y-5 mb-10">
                    {["Bulk SMS to entire class or school", "Automated fee balance reminders", "Report card delivery notifications", "Absence alerts sent within minutes"].map((item, i) => (
                      <li key={i} className="flex items-center gap-4 text-dark-navy font-bold tracking-tight">
                        <div className="bg-teal-accent p-1 rounded-lg text-deep-teal"><Check className="w-4 h-4" /></div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:w-1/2 ds-card bg-muted-warm aspect-video flex items-center justify-center p-12 text-center border-brand-border shadow-inner">
                  <MessageSquare size={48} className="text-brand-border" />
                </div>
              </div>
            </section>

            <section id="learner-support" className="scroll-mt-32">
              <div className="flex flex-col md:flex-row items-center gap-16">
                <div className="md:w-1/2">
                  <div className="ds-badge bg-[#fee2e2] text-brand-primary mb-6"><Flag className="w-3 h-3" /> Learner Support</div>
                  <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight leading-tight">Learner Support Flags</h2>
                  <p className="text-muted-text text-lg mb-8 leading-relaxed font-normal">
                    ShuleHQ automatically identifies students who are falling behind based on their CBC assessment trends. Teachers and directors see a clear list of learners needing extra attention — before the term is over.
                  </p>
                  <ul className="space-y-5 mb-10">
                    {["Automatic BE/AE performance flags", "Strand-level weakness detection", "Support action log per learner", "Linked to attendance patterns"].map((item, i) => (
                      <li key={i} className="flex items-center gap-4 text-dark-navy font-bold tracking-tight">
                        <div className="bg-teal-accent p-1 rounded-lg text-deep-teal"><Check className="w-4 h-4" /></div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:w-1/2 ds-card bg-muted-warm aspect-video flex items-center justify-center p-12 text-center border-brand-border shadow-inner">
                  <Flag size={48} className="text-brand-border" />
                </div>
              </div>
            </section>

            <section id="rbac" className="scroll-mt-32">
              <div className="flex flex-col md:flex-row-reverse items-center gap-16">
                <div className="md:w-1/2">
                  <div className="ds-badge bg-light-sand text-amber-brown mb-6"><Lock className="w-3 h-3" /> Access Control</div>
                  <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight leading-tight">Multi-role Access Control</h2>
                  <p className="text-muted-text text-lg mb-8 leading-relaxed font-normal">
                    Every user in your school sees exactly what they need and nothing more. Directors get full oversight. Teachers see their classes. Bursars manage finance. Parents access their child only.
                  </p>
                  <ul className="space-y-5 mb-10">
                    {["Director, Principal, Teacher, Bursar roles", "Fine-grained permission controls", "Parent & learner portal access", "Audit trail of every action"].map((item, i) => (
                      <li key={i} className="flex items-center gap-4 text-dark-navy font-bold tracking-tight">
                        <div className="bg-teal-accent p-1 rounded-lg text-deep-teal"><Check className="w-4 h-4" /></div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:w-1/2 ds-card bg-muted-warm aspect-video flex items-center justify-center p-12 text-center border-brand-border shadow-inner">
                  <Lock size={48} className="text-brand-border" />
                </div>
              </div>
            </section>

            <section id="audit" className="scroll-mt-32">
              <div className="flex flex-col md:flex-row items-center gap-16">
                <div className="md:w-1/2">
                  <div className="ds-badge bg-teal-accent text-deep-teal mb-6"><History className="w-3 h-3" /> Compliance</div>
                  <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight leading-tight">Audit Log & Compliance</h2>
                  <p className="text-muted-text text-lg mb-8 leading-relaxed font-normal">
                    Every action in ShuleHQ — from a fee recorded to a grade updated — is logged with a timestamp and user ID. The tamper-proof audit trail gives school directors full accountability.
                  </p>
                  <ul className="space-y-5 mb-10">
                    {["Immutable action log per user", "90-day retention by default", "Exportable for board or audit review", "Data isolation per school tenant"].map((item, i) => (
                      <li key={i} className="flex items-center gap-4 text-dark-navy font-bold tracking-tight">
                        <div className="bg-teal-accent p-1 rounded-lg text-deep-teal"><Check className="w-4 h-4" /></div>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="md:w-1/2 ds-card bg-muted-warm aspect-video flex items-center justify-center p-12 text-center border-brand-border shadow-inner">
                  <History size={48} className="text-brand-border" />
                </div>
              </div>
            </section>

            <section className="bg-dark-navy rounded-[3.5rem] p-12 md:p-20 text-white text-center shadow-2xl relative overflow-hidden border border-white/5">
              <h2 className="text-4xl font-bold mb-6 relative z-10 tracking-tight leading-tight">Start automating <br /> your school today.</h2>
              <p className="text-warm-cream/60 text-lg mb-12 relative z-10 font-normal">Join the waitlist or book a personal walkthrough.</p>
              <Link href="/demo" className="btn-dark-section px-12 py-5 text-xl relative z-10">
                Let's Talk
              </Link>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
