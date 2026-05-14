"use client";

import { Check } from "lucide-react";

/** CBC grading grid mockup */
export function CbcMockup() {
  const grades = ["EE", "ME", "ME", "AE", "EE", "ME", "AE", "EE", "ME", "ME", "EE", "AE"];
  const gradeColors: Record<string, string> = {
    EE: "bg-[#d1fae5] text-forest-green",
    ME: "bg-teal-accent text-deep-teal",
    AE: "bg-light-sand text-amber-brown",
    BE: "bg-[#fee2e2] text-brand-primary",
  };
  return (
    <div className="ds-card bg-white aspect-video flex flex-col p-6 overflow-hidden border-brand-border shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-bold text-dark-navy tracking-tight">Grade 4 • Mathematics</p>
          <p className="text-[10px] text-muted-text font-medium">Term 2 — Formative Assessment</p>
        </div>
        <div className="flex gap-1">
          {["EE","ME","AE","BE"].map(g => (
            <span key={g} className={`text-[9px] font-black px-1.5 py-0.5 rounded ${gradeColors[g]}`}>{g}</span>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="grid grid-cols-5 gap-1 text-[9px] font-bold text-muted-text mb-1 px-1">
          <span className="col-span-2">Student</span>
          <span className="text-center">Numbers</span>
          <span className="text-center">Geometry</span>
          <span className="text-center">Data</span>
        </div>
        {[
          ["Amina Waweru", "EE", "ME", "EE"],
          ["Brian Otieno", "ME", "ME", "AE"],
          ["Cynthia Kamau", "AE", "AE", "ME"],
          ["Daniel Mwangi", "EE", "EE", "EE"],
          ["Esther Njoki", "ME", "AE", "ME"],
          ["Felix Odhiambo", "AE", "ME", "AE"],
        ].map(([name, ...gs], i) => (
          <div key={i} className="grid grid-cols-5 gap-1 mb-1">
            <div className="col-span-2 bg-muted-warm rounded px-2 py-1.5">
              <p className="text-[9px] font-bold text-dark-navy truncate">{name}</p>
            </div>
            {gs.map((g, j) => (
              <div key={j} className={`rounded flex items-center justify-center py-1.5 ${gradeColors[g as keyof typeof gradeColors]}`}>
                <span className="text-[9px] font-black">{g}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Fee / receipt mockup */
export function FinanceMockup() {
  const payments = [
    { name: "Amina Waweru", amount: "KES 18,500", method: "M-Pesa", status: "Verified" },
    { name: "Brian Otieno", amount: "KES 22,000", method: "Cash", status: "Recorded" },
    { name: "Cynthia Kamau", amount: "KES 9,500", method: "Bank", status: "Pending" },
    { name: "Daniel Mwangi", amount: "KES 18,500", method: "M-Pesa", status: "Verified" },
  ];
  return (
    <div className="ds-card bg-white aspect-video flex flex-col p-6 overflow-hidden border-brand-border shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-bold text-dark-navy tracking-tight">Fee Ledger — Term 2, 2026</p>
        <span className="text-[9px] font-black bg-[#d1fae5] text-forest-green px-2 py-0.5 rounded-full">3 Verified</span>
      </div>
      <div className="space-y-2 flex-1">
        {payments.map((p, i) => (
          <div key={i} className="flex items-center gap-2 bg-muted-warm/60 rounded-lg px-3 py-2">
            <div className="w-6 h-6 bg-brand-primary/10 rounded-full flex items-center justify-center text-brand-primary font-black text-[8px]">
              {p.name.split(" ").map(n => n[0]).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold text-dark-navy truncate">{p.name}</p>
              <p className="text-[8px] text-muted-text font-medium">{p.method}</p>
            </div>
            <p className="text-[9px] font-black text-dark-navy">{p.amount}</p>
            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${p.status === "Verified" ? "bg-[#d1fae5] text-forest-green" : p.status === "Pending" ? "bg-light-sand text-amber-brown" : "bg-teal-accent text-deep-teal"}`}>
              {p.status}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-brand-border flex justify-between">
        <p className="text-[9px] text-muted-text font-bold">Total collected this term</p>
        <p className="text-[9px] font-black text-dark-navy">KES 68,500</p>
      </div>
    </div>
  );
}

/** Parent portal mockup */
export function ParentMockup() {
  return (
    <div className="ds-card bg-white aspect-video flex flex-col p-6 overflow-hidden border-brand-border shadow-xl">
      <div className="bg-dark-navy rounded-xl p-4 mb-4 text-white">
        <p className="text-[9px] font-bold text-warm-cream/60 mb-1">PARENT PORTAL</p>
        <p className="text-sm font-bold">Amina Waweru — Grade 4</p>
        <p className="text-[9px] text-warm-cream/50 mt-0.5">Gateway School • Term 2, 2026</p>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-[#d1fae5] rounded-lg p-3">
          <p className="text-[8px] text-forest-green font-bold uppercase tracking-wide mb-1">Academic</p>
          <p className="text-base font-black text-forest-green">EE</p>
          <p className="text-[8px] text-forest-green/70">Exceeding Expectation</p>
        </div>
        <div className="bg-light-sand rounded-lg p-3">
          <p className="text-[8px] text-amber-brown font-bold uppercase tracking-wide mb-1">Balance</p>
          <p className="text-base font-black text-amber-brown">KES 0</p>
          <p className="text-[8px] text-amber-brown/70">Fully paid ✓</p>
        </div>
      </div>
      <div className="bg-brand-primary rounded-lg px-4 py-2.5 flex items-center justify-between">
        <p className="text-[9px] font-bold text-white">Pay via M-Pesa</p>
        <div className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center">
          <Check size={10} className="text-white" />
        </div>
      </div>
    </div>
  );
}

/** Analytics / chart mockup */
export function AnalyticsMockup() {
  const bars = [
    { label: "EE", h: "h-20", color: "bg-[#d1fae5]", text: "text-forest-green", val: "34%" },
    { label: "ME", h: "h-28", color: "bg-teal-accent", text: "text-deep-teal", val: "48%" },
    { label: "AE", h: "h-12", color: "bg-light-sand", text: "text-amber-brown", val: "13%" },
    { label: "BE", h: "h-6", color: "bg-[#fee2e2]", text: "text-brand-primary", val: "5%" },
  ];
  return (
    <div className="ds-card bg-white aspect-video flex flex-col p-6 overflow-hidden border-brand-border shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-bold text-dark-navy">Class Performance — Term 2</p>
        <span className="text-[9px] font-black bg-teal-accent text-deep-teal px-2 py-0.5 rounded-full">28 Learners</span>
      </div>
      <div className="flex-1 flex items-end gap-4 pb-2">
        {bars.map((bar, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <p className={`text-[10px] font-black ${bar.text}`}>{bar.val}</p>
            <div className={`w-full ${bar.h} ${bar.color} rounded-t-lg transition-all`}></div>
            <p className={`text-[9px] font-black ${bar.text}`}>{bar.label}</p>
          </div>
        ))}
        <div className="flex-1"></div>
      </div>
      <div className="mt-3 pt-3 border-t border-brand-border">
        <p className="text-[9px] text-muted-text font-medium">82% of learners are Meeting or Exceeding Expectation</p>
      </div>
    </div>
  );
}
