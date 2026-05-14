import { ShieldCheck, Users, BookOpenCheck, Wallet, BarChart3, Zap, Globe, Lock } from "lucide-react";

const updates = [
  {
    date: "May 2026",
    version: "v1.4.0",
    title: "Marketing Site & Public Launch",
    desc: "ShuleHQ is now publicly available. Schools can sign up via the website and get onboarded within 24 hours.",
    icon: Globe,
    type: "Major",
    changes: [
      "Public marketing site live at shulehq.co.ke",
      "Automated tenant provisioning from admin panel",
      "Sign-in subdomain routing for all schools",
      "Demo request pipeline connected to support team",
    ],
  },
  {
    date: "April 2026",
    version: "v1.3.0",
    title: "Multi-role Access Control (RBAC)",
    desc: "Every user in the system now sees exactly what they need and nothing more.",
    icon: Lock,
    type: "Feature",
    changes: [
      "Director, Principal, Teacher, Bursar and Parent role sets",
      "Fine-grained permission enforcement on all endpoints",
      "Parent portal access — view child's grades and fee status only",
      "Audit trail: every action logged with timestamp and user ID",
    ],
  },
  {
    date: "March 2026",
    version: "v1.2.0",
    title: "CBC Analytics Dashboard",
    desc: "Directors now have a real-time view of their school's academic performance across all classes and learning areas.",
    icon: BarChart3,
    type: "Feature",
    changes: [
      "Class-level EE/ME/AE/BE distribution charts",
      "Learner Support Flags — auto-identified students needing intervention",
      "Strand-level weakness detection per class and per learner",
      "Term comparison analytics across assessment periods",
    ],
  },
  {
    date: "February 2026",
    version: "v1.1.0",
    title: "Fee Tracking & M-Pesa Reconciliation",
    desc: "Schools can now record any payment type and reconcile M-Pesa codes against student ledgers.",
    icon: Wallet,
    type: "Feature",
    changes: [
      "Record payments: cash, M-Pesa, bank transfer, cheque",
      "M-Pesa confirmation code matching against student accounts",
      "Parent payment receipt portal — searchable by phone or code",
      "Outstanding balance reports with per-student drill-down",
    ],
  },
  {
    date: "January 2026",
    version: "v1.0.0",
    title: "CBC Assessment Engine — Core Release",
    desc: "The first production release of the ShuleHQ CBC grading engine, aligned to KICD Junior School standards.",
    icon: BookOpenCheck,
    type: "Major",
    changes: [
      "Formative strand and sub-strand grading (EE / ME / AE / BE)",
      "Summative end-of-term aggregation per learning area",
      "Digital report card generation per student per term",
      "Teacher dashboard: grade entry, class roster, assessment history",
    ],
  },
  {
    date: "November 2025",
    version: "v0.9.0",
    title: "Multi-tenant Architecture & SaaS Admin",
    desc: "The infrastructure that powers isolated school environments — each school gets its own secure database schema and subdomain.",
    icon: ShieldCheck,
    type: "Infrastructure",
    changes: [
      "Subdomain-based tenant resolution (school.shulehq.co.ke)",
      "SaaS admin panel: tenant provisioning and monitoring",
      "Per-tenant database isolation via PostgreSQL schemas",
      "Role-based JWT authentication with secure cookie handling",
    ],
  },
  {
    date: "October 2025",
    version: "v0.8.0",
    title: "Student Registry & Attendance",
    desc: "Digital student records and daily attendance registers replace paper-based systems.",
    icon: Users,
    type: "Feature",
    changes: [
      "Student profiles with guardian and contact details",
      "Class enrollment and year-level management",
      "Per-class daily attendance registers",
      "Term-level attendance summaries with absence tracking",
    ],
  },
  {
    date: "September 2025",
    version: "v0.1.0",
    title: "Project Inception",
    desc: "ShuleHQ development begins. Core data models and API framework established.",
    icon: Zap,
    type: "Internal",
    changes: [
      "FastAPI backend with PostgreSQL and Alembic migrations",
      "Next.js 15 frontend with App Router and Tailwind v4",
      "Docker-based local development environment",
      "Initial domain modeling: students, classes, users, tenants",
    ],
  },
];

const typeColors: Record<string, string> = {
  Major: "bg-brand-primary/10 text-brand-primary border-brand-primary/20",
  Feature: "bg-teal-accent text-deep-teal border-deep-teal/15",
  Infrastructure: "bg-light-sand text-amber-brown border-amber-brown/20",
  Improvement: "bg-[#d1fae5] text-forest-green border-forest-green/20",
  Internal: "bg-muted-warm text-muted-text border-brand-border",
};

export default function ChangelogPage() {
  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-20 bg-dark-navy text-white text-center border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4">
          <span className="label-caps text-brand-primary mb-6 block">Build History</span>
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight mb-8 leading-tight">
            The ShuleHQ <span className="text-brand-primary italic">Changelog</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-warm-cream/60 leading-relaxed font-normal">
            Every feature we ship, every improvement we make — documented here. We build in public.
          </p>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="relative border-l-2 border-brand-border ml-4 md:ml-52 pl-12 space-y-20">
            {updates.map((update, i) => (
              <div key={i} className="relative">
                <div className="hidden md:block absolute -left-64 top-0 w-52 text-right">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border mb-2 ${typeColors[update.type] ?? typeColors.Internal}`}>
                    {update.type}
                  </span>
                  <p className="label-caps text-brand-primary text-[10px] mb-0.5">{update.version}</p>
                  <p className="font-bold text-dark-navy tracking-tight text-sm">{update.date}</p>
                </div>

                <div className={`absolute -left-[62px] top-1 w-6 h-6 rounded-full border-4 shadow-sm ${i === 0 ? "bg-brand-primary border-brand-primary" : "bg-white border-brand-primary"}`}></div>

                <div className="ds-card p-10 bg-page-bg/30 border-brand-border hover:bg-white transition-colors">
                  <div className="flex items-center gap-3 mb-6 md:hidden flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border ${typeColors[update.type] ?? typeColors.Internal}`}>
                      {update.type}
                    </span>
                    <span className="label-caps text-brand-primary text-[10px]">{update.version}</span>
                    <span className="font-bold text-dark-navy text-sm">{update.date}</span>
                  </div>

                  <div className="flex items-start gap-4 mb-6">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-brand-primary shadow-sm border border-brand-border shrink-0">
                      <update.icon size={24} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-dark-navy tracking-tight leading-tight">{update.title}</h3>
                      <p className="text-muted-text mt-2 font-normal leading-relaxed">{update.desc}</p>
                    </div>
                  </div>

                  <ul className="space-y-3 pl-2">
                    {update.changes.map((change, j) => (
                      <li key={j} className="flex gap-3 text-dark-navy font-medium tracking-tight text-sm">
                        <div className="w-1.5 h-1.5 bg-brand-primary rounded-full mt-1.5 shrink-0"></div>
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-20 ml-4 md:ml-52 pl-12 relative">
            <div className="absolute -left-[62px] top-3 w-6 h-6 rounded-full bg-brand-border border-4 border-brand-border/40"></div>
            <p className="text-muted-text font-medium text-sm italic">You're at the beginning of the ShuleHQ story.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
