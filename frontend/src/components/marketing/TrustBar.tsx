"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { BookOpenCheck, Receipt, ShieldCheck, IdCard } from "lucide-react";

export type PublicStats = {
  schools_active: number;
  students_total: number;
} | null;

// Honest capability cards — each maps to a shipped feature, no fluff.
const capabilities = [
  { Icon: BookOpenCheck, title: "CBC assessments", desc: "KICD-aligned rubrics and report cards, generated from daily entries.", tint: "bg-teal-accent text-deep-teal" },
  { Icon: IdCard, title: "KEMIS / ULI records", desc: "Capture each learner once — no re-keying into national systems.", tint: "bg-light-sand text-amber-brown" },
  { Icon: Receipt, title: "Instant parent receipts", desc: "An SMS receipt the moment a fee is recorded — disputes gone.", tint: "bg-[#d1fae5] text-forest-green" },
  { Icon: ShieldCheck, title: "Audit & data protection", desc: "Tamper-evident logs, and every school's data fully isolated.", tint: "bg-[#fee2e2] text-brand-primary" },
];

// Live counts pulled from the DB — never fabricated. The school count only
// surfaces once it's substantial; below that we lead with learners + standards.
const SCHOOL_COUNT_THRESHOLD = 5;
function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k+`;
  return `${n}`;
}

export function TrustBar({ stats }: { stats?: PublicStats }) {
  const showStudents = !!stats && stats.students_total > 0;
  const showSchools = !!stats && stats.schools_active >= SCHOOL_COUNT_THRESHOLD;

  return (
    <section className="py-20 md:py-24 px-4 bg-white border-y border-brand-border">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-14 max-w-2xl mx-auto">
          <span className="label-caps text-brand-primary mb-3 block">Everything a Kenyan school needs</span>
          <h2 className="text-3xl md:text-4xl font-bold text-dark-navy tracking-tight font-display">
            One platform, built to the national standard
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {capabilities.map(({ Icon, title, desc, tint }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="ds-card p-7 hover:-translate-y-1 transition-all group"
            >
              <div className={`w-12 h-12 ${tint} rounded-xl flex items-center justify-center mb-5 shadow-sm border border-brand-border/20 transition-transform group-hover:scale-110`}>
                <Icon size={24} />
              </div>
              <h3 className="font-bold text-dark-navy text-lg mb-1.5 tracking-tight font-display">{title}</h3>
              <p className="text-muted-text text-[15px] leading-relaxed font-normal">{desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Live proof + standards alignment */}
        <div className="mt-14 flex flex-col md:flex-row items-center justify-center gap-x-12 gap-y-6 border-t border-brand-border pt-10">
          {showStudents && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-dark-navy tracking-tight">{fmt(stats!.students_total)}</span>
              <span className="label-caps text-muted-text">learners managed</span>
            </div>
          )}
          {showSchools && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-dark-navy tracking-tight">{fmt(stats!.schools_active)}</span>
              <span className="label-caps text-muted-text">schools</span>
            </div>
          )}
          <div className="flex items-center gap-4">
            <span className="label-caps text-muted-text">Aligned with</span>
            <Image src="/brand/kicd-logo.png" alt="KICD" width={80} height={22} className="h-[22px] w-auto object-contain" />
            <span className="h-5 w-px bg-brand-border" />
            <Image src="/brand/kemis-logo.png" alt="KEMIS" width={96} height={22} className="h-[22px] w-auto object-contain" />
          </div>
        </div>
      </div>
    </section>
  );
}
