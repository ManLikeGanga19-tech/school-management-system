"use client";

import { useState } from "react";
import { Star, MessageSquare, CheckCircle2, Loader2 } from "lucide-react";

const STUDENT_COUNT_MAP: Record<string, number> = {
  "< 100 students": 50,
  "100 – 300 students": 200,
  "300 – 600 students": 450,
  "600+ students": 700,
};

export default function DemoPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", school: "", role: "Director", students: "< 100 students",
    curriculum: "CBC (Competency Based)", phone: "", email: "", goal: "",
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1"}/public/demo-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.name,
          school_name: form.school,
          email: form.email,
          phone: form.phone || undefined,
          role: form.role,
          student_count: STUDENT_COUNT_MAP[form.students] ?? undefined,
          curriculum: form.curriculum,
          goal: form.goal || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { detail?: string }).detail ?? "Something went wrong. Please try again.");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-16">
            <div className="lg:w-3/5">
              <div className="ds-card bg-white p-8 md:p-12 shadow-sm">
                <h2 className="text-3xl font-bold text-dark-navy mb-4 tracking-tight">See ShuleHQ in action</h2>
                <p className="text-muted-text mb-10 leading-relaxed font-normal">
                  We'll show you a live demo tailored to your school type and size. Most demos take 30 minutes including Q&A.
                </p>

                {submitted ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-6 text-center">
                    <CheckCircle2 size={56} className="text-forest-green" />
                    <h3 className="text-2xl font-bold text-dark-navy tracking-tight">Request sent!</h3>
                    <p className="text-muted-text max-w-sm leading-relaxed">We'll reach out within one business day to schedule your personalised demo.</p>
                  </div>
                ) : (
                  <form className="space-y-8" onSubmit={handleSubmit}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <label className="block label-caps text-muted-text mb-3">Full name</label>
                        <input type="text" placeholder="e.g. David Mwangi" value={form.name} onChange={set("name")}
                          className="w-full px-5 py-4 rounded-xl border border-brand-border focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all placeholder:font-normal font-bold text-dark-navy placeholder:text-muted-text/30" />
                      </div>
                      <div>
                        <label className="block label-caps text-muted-text mb-3">School name</label>
                        <input type="text" placeholder="e.g. Greenhill Academy" value={form.school} onChange={set("school")}
                          className="w-full px-5 py-4 rounded-xl border border-brand-border focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all placeholder:font-normal font-bold text-dark-navy placeholder:text-muted-text/30" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <label className="block label-caps text-muted-text mb-3">Role</label>
                        <select value={form.role} onChange={set("role")}
                          className="w-full px-5 py-4 rounded-xl border border-brand-border focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all appearance-none bg-white font-bold text-dark-navy">
                          <option>Director</option>
                          <option>Principal</option>
                          <option>Bursar / Secretary</option>
                          <option>Proprietor</option>
                          <option>Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block label-caps text-muted-text mb-3">Number of students</label>
                        <select value={form.students} onChange={set("students")}
                          className="w-full px-5 py-4 rounded-xl border border-brand-border focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all appearance-none bg-white font-bold text-dark-navy">
                          <option>{"< 100 students"}</option>
                          <option>100 – 300 students</option>
                          <option>300 – 600 students</option>
                          <option>600+ students</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <label className="block label-caps text-muted-text mb-3">Curriculum</label>
                        <select value={form.curriculum} onChange={set("curriculum")}
                          className="w-full px-5 py-4 rounded-xl border border-brand-border focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all appearance-none bg-white font-bold text-dark-navy">
                          <option>CBC (Competency Based)</option>
                          <option>Traditional (8-4-4)</option>
                          <option>International (IGCSE)</option>
                          <option>Multiple curriculums</option>
                        </select>
                      </div>
                      <div>
                        <label className="block label-caps text-muted-text mb-3">Phone number</label>
                        <input type="tel" placeholder="+254 700 000 000" value={form.phone} onChange={set("phone")}
                          className="w-full px-5 py-4 rounded-xl border border-brand-border focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all placeholder:font-normal font-bold text-dark-navy placeholder:text-muted-text/30" />
                      </div>
                    </div>

                    <div>
                      <label className="block label-caps text-muted-text mb-3">Email address</label>
                      <input type="email" placeholder="name@school.com" value={form.email} onChange={set("email")}
                        className="w-full px-5 py-4 rounded-xl border border-brand-border focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all placeholder:font-normal font-bold text-dark-navy placeholder:text-muted-text/30" />
                    </div>

                    <div>
                      <label className="block label-caps text-muted-text mb-3">Primary goal? (Optional)</label>
                      <textarea placeholder="e.g. Collecting fees on time or CBC report card processing..." rows={3} value={form.goal} onChange={set("goal")}
                        className="w-full px-5 py-4 rounded-xl border border-brand-border focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all placeholder:font-normal font-bold text-dark-navy placeholder:text-muted-text/30"></textarea>
                    </div>

                    {error && (
                      <p className="text-sm text-red-600 font-medium text-center bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
                    )}
                    <button type="submit" disabled={loading} className="btn-primary w-full py-6 text-xl shadow-2xl shadow-brand-primary/20 flex items-center justify-center gap-3 disabled:opacity-60">
                      {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Sending…</> : "Book My Free Demo →"}
                    </button>
                    <p className="text-center text-[10px] text-muted-text font-bold uppercase tracking-[0.2em]">We typically respond within 2 hours.</p>
                  </form>
                )}
              </div>
            </div>

            <div className="lg:w-2/5 flex flex-col gap-10">
              <div className="p-8">
                <h3 className="label-caps text-brand-primary mb-10">How it works</h3>
                <div className="space-y-12">
                  {[
                    { n: "1", title: "Submit this form", desc: "Tell us about your school needs and biggest pain points.", hasDivider: true },
                    { n: "2", title: "We call you back", desc: "We'll reach out within 2 hours to confirm a convenient time.", hasDivider: true },
                    { n: "3", title: "30-min live demo", desc: "A personalized tour of the features that matter most. No pressure.", hasDivider: false },
                  ].map((step, i) => (
                    <div key={i} className="flex gap-8 relative group">
                      {step.hasDivider && <div className="absolute top-10 left-5 w-px h-16 bg-brand-border"></div>}
                      <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm transition-all ${i === 2 ? "bg-brand-primary text-white shadow-xl shadow-brand-primary/20 group-hover:scale-105" : "bg-teal-accent text-deep-teal group-hover:bg-brand-primary group-hover:text-white"}`}>
                        {step.n}
                      </div>
                      <div>
                        <p className="font-bold text-dark-navy text-lg mb-1 tracking-tight">{step.title}</p>
                        <p className="text-muted-text text-base font-normal">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ds-card bg-muted-warm rounded-[2.5rem] p-10 border border-brand-border relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 translate-x-4 -translate-y-4 group-hover:translate-x-2 transition-transform">
                  <Star size={100} />
                </div>
                <div className="flex text-amber-brown mb-6 gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="fill-current w-4 h-4" />)}
                </div>
                <p className="text-dark-navy italic text-lg mb-6 leading-relaxed font-normal">
                  "ShuleHQ understood exactly what we needed. CBC grading used to take us weeks — now our teachers finish it in a day."
                </p>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-brand-primary rounded-full flex items-center justify-center text-white font-bold text-xs shadow-sm">MN</div>
                  <div>
                    <p className="font-bold text-dark-navy text-sm tracking-tight">Madam Naum</p>
                    <p className="label-caps text-brand-primary">Director, Novel School</p>
                  </div>
                </div>
              </div>

              <div className="p-10 border-t border-brand-border">
                <p className="label-caps text-muted-text mb-6">Prefer direct contact?</p>
                <div className="flex items-center gap-6 group cursor-pointer">
                  <div className="w-14 h-14 bg-forest-green/10 text-forest-green rounded-2xl flex items-center justify-center group-hover:scale-110 transition-all border border-forest-green/20 shadow-sm">
                    <MessageSquare size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-text font-bold uppercase tracking-widest mb-1">WhatsApp / Call</p>
                    <p className="font-bold text-dark-navy text-xl tracking-tight leading-none group-hover:text-brand-primary transition-colors">+254 785 640 048</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
