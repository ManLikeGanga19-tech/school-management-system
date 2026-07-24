import { ShieldCheck, Users, BookOpenCheck, Wallet, BarChart3, Globe, Lock } from "lucide-react";

// Changelog entries track REAL released versions. The current version is the
// git tag on GitHub (v1.0.0). Pre-1.0 entries describe capabilities that
// genuinely shipped during development — no invented features or future dates.
const updates = [
  {
    date: "Jul 2026",
    version: "v1.0.0",
    title: "General Availability",
    desc: "The first tagged production release. ShuleHQ now runs on dedicated, self-managed infrastructure with verified backups, external monitoring, and edge security.",
    icon: Globe,
    type: "Major",
    changes: [
      "Dedicated infrastructure with wildcard TLS for every school subdomain",
      "Automated, restore-verified backups with off-site copies",
      "External uptime, certificate and backup monitoring with alerting",
      "Cloudflare edge protection and human verification (Turnstile) on login",
      "Significant performance and database tuning across the platform",
    ],
  },
  {
    date: "Pre-release",
    version: "Pre-1.0",
    title: "Fee Recording & Parent Receipts",
    desc: "Record any payment and keep parents informed automatically — without changing how your school collects money.",
    icon: Wallet,
    type: "Feature",
    changes: [
      "Record payments: cash, M-Pesa, bank transfer or cheque",
      "Scan physical receipts into verifiable digital records",
      "Invoices and balances update the moment a payment is recorded",
      "Automatic SMS receipt to the parent, verifiable on a secure portal",
    ],
  },
  {
    date: "Pre-release",
    version: "Pre-1.0",
    title: "CBC Assessments & Reporting",
    desc: "Digital CBC assessment aligned to KICD standards, with report cards and term-over-term performance views.",
    icon: BookOpenCheck,
    type: "Feature",
    changes: [
      "Formative strand and sub-strand entry (EE / ME / AE / BE)",
      "Summative end-of-term aggregation per learning area",
      "KICD-standard report card generation per learner per term",
      "Stream distribution and term-over-term performance trends",
    ],
  },
  {
    date: "Pre-release",
    version: "Pre-1.0",
    title: "Student Registry & Attendance",
    desc: "Digital student records and daily attendance replace paper registers.",
    icon: Users,
    type: "Feature",
    changes: [
      "Student profiles with guardian and contact details",
      "Class enrollment and year-level management",
      "Daily class registers and school-wide roll call",
      "Term-level attendance summaries with absence tracking",
    ],
  },
  {
    date: "Pre-release",
    version: "Pre-1.0",
    title: "Roles, Access Control & Audit",
    desc: "Every user sees exactly what they need — and every action is logged.",
    icon: Lock,
    type: "Feature",
    changes: [
      "Director, Principal, Secretary, Teacher and Parent role sets",
      "Fine-grained permission enforcement on every endpoint",
      "Parent portal scoped to a family's own children only",
      "Tamper-evident audit trail: every action with timestamp and user",
    ],
  },
  {
    date: "Pre-release",
    version: "Pre-1.0",
    title: "Multi-tenant Foundation",
    desc: "The platform that gives each school its own isolated, secure environment on its own subdomain.",
    icon: ShieldCheck,
    type: "Infrastructure",
    changes: [
      "Subdomain-based tenant resolution (school.shulehq.co.ke)",
      "Strict per-tenant data isolation",
      "SaaS admin panel: tenant provisioning and oversight",
      "Role-based JWT authentication with secure cookie handling",
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
