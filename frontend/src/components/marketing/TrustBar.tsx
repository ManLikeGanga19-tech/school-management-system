"use client";

import { motion } from "framer-motion";
import { BookOpenCheck, Receipt, ShieldCheck, IdCard } from "lucide-react";

export type PublicStats = {
  schools_active: number;
  students_total: number;
} | null;

// Honest capability signals — true today, no numbers to inflate.
const badges = [
  { Icon: BookOpenCheck, label: "CBC-ready · KICD-aligned" },
  { Icon: IdCard, label: "KEMIS / ULI-compliant records" },
  { Icon: Receipt, label: "Instant parent SMS receipts" },
  { Icon: ShieldCheck, label: "Audit logs & data protection" },
];

// Only surface the school count once it's substantial enough to impress;
// below the threshold we lead with students + capabilities instead. The
// numbers are pulled live from the database, so they can never be fabricated
// and they update themselves as the platform grows.
const SCHOOL_COUNT_THRESHOLD = 5;

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k+`;
  return `${n}`;
}

export function TrustBar({ stats }: { stats?: PublicStats }) {
  const showStudents = !!stats && stats.students_total > 0;
  const showSchools = !!stats && stats.schools_active >= SCHOOL_COUNT_THRESHOLD;

  const numbers: { value: string; label: string }[] = [];
  if (showSchools) numbers.push({ value: fmt(stats!.schools_active), label: "Schools on ShuleHQ" });
  if (showStudents) numbers.push({ value: fmt(stats!.students_total), label: "Students managed" });

  return (
    <section className="py-16 border-y border-brand-border bg-white">
      <div className="max-w-5xl mx-auto px-4">
        <p className="label-caps text-muted-text text-center mb-10">Everything a Kenyan school needs, done right</p>

        {/* Capability badges — always honest, always true. */}
        <div className="flex flex-wrap justify-center gap-3 md:gap-4">
          {badges.map(({ Icon, label }, i) => (
            <motion.span
              key={label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-page-bg px-4 py-2 text-sm font-semibold text-dark-navy"
            >
              <Icon className="w-4 h-4 text-brand-primary" />
              {label}
            </motion.span>
          ))}
        </div>

        {/* Live numbers — rendered only when real data is available and
            meaningful. No fabricated counts, ever. */}
        {numbers.length > 0 && (
          <div className={`mt-14 grid gap-8 text-center ${numbers.length === 1 ? "grid-cols-1 max-w-xs mx-auto" : "grid-cols-2 max-w-md mx-auto"}`}>
            {numbers.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <p className="text-4xl font-bold text-dark-navy tracking-tight mb-1">{stat.value}</p>
                <p className="label-caps text-muted-text">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
