"use client";

import { motion } from "framer-motion";
import { useRef } from "react";

const schools = [
  "SUNRISE ACADEMY",
  "HIGHLAND PREP",
  "GATEWAY SCHOOL",
  "GREENFIELD JUNIOR",
  "MARA HILLS ACADEMY",
  "JUBILEE PREP",
  "ST. CLAIRE'S SCHOOL",
  "EDEN VALLEY ACADEMY",
  "CRYSTAL SPRINGS PREP",
  "LAKEVIEW JUNIOR",
];

const stats = [
  { value: "40+", label: "Active Schools" },
  { value: "12k+", label: "Registered Students" },
  { value: "3", label: "Counties Served" },
  { value: "99.9%", label: "Uptime SLA" },
];

const duplicated = [...schools, ...schools];

export function TrustBar() {
  return (
    <section className="py-16 border-y border-brand-border bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 text-center mb-10">
        <p className="label-caps text-muted-text">Schools that trust ShuleHQ</p>
      </div>

      {/* Marquee */}
      <div className="relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />
        <motion.div
          className="flex items-center gap-16 whitespace-nowrap"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 28, ease: "linear", repeat: Infinity }}
        >
          {duplicated.map((name, i) => (
            <span
              key={i}
              className="text-lg font-bold italic text-dark-navy/25 tracking-tight font-display hover:text-dark-navy/60 transition-colors cursor-default shrink-0"
            >
              {name}
            </span>
          ))}
        </motion.div>
      </div>

      {/* Stats */}
      <div className="max-w-4xl mx-auto px-4 mt-14 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {stats.map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
          >
            <p className="text-3xl font-bold text-dark-navy tracking-tight mb-1">{stat.value}</p>
            <p className="label-caps text-muted-text">{stat.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
