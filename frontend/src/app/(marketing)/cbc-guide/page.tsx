import Link from "next/link";
import { BookOpen, Target, ShieldCheck, PieChart, Download } from "lucide-react";

const competencies = [
  "Communication & Collaboration",
  "Self-efficacy",
  "Critical Thinking",
  "Creativity & Imagination",
  "Citizenship",
  "Digital Literacy",
  "Learning to Learn",
];

export default function CbcGuidePage() {
  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-20 bg-dark-navy text-white border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center gap-16">
          <div className="md:w-1/2">
            <span className="ds-badge bg-brand-primary text-white mb-6 uppercase">Education Hub</span>
            <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight mb-8 leading-tight">
              Mastering the <br /> <span className="text-brand-primary italic">CBC Framework</span>
            </h1>
            <p className="max-w-xl text-xl text-warm-cream/60 leading-relaxed font-normal mb-10">
              The shift from 8-4-4 to CBC is the biggest change in Kenyan education history. We've built the tools and knowledge to help you lead the way.
            </p>
            <button className="btn-dark-section px-8 py-4 flex items-center gap-2">
              Download Guide (PDF) <Download size={18} />
            </button>
          </div>
          <div className="md:w-1/2 bg-white/5 rounded-[3rem] aspect-square flex items-center justify-center p-12 border border-white/10 italic text-warm-cream/20 text-center font-medium">
            <div className="flex flex-col items-center gap-6">
              <BookOpen size={64} className="opacity-10" />
              <p>[Illustration: The 7 Core Competencies of CBC graphically represented]</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-7xl mx-auto text-center mb-20">
          <h2 className="text-4xl font-bold text-dark-navy mb-4 tracking-tight">The 7 Core Competencies</h2>
          <p className="text-muted-text max-w-2xl mx-auto font-normal">CBC aims to produce engaged, empowered, and ethical citizens. Here is what we track in ShuleHQ.</p>
        </div>
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {competencies.map((competency, i) => (
            <div key={i} className="ds-card p-6 bg-page-bg/30 border-brand-border text-center flex flex-col items-center gap-4 hover:border-brand-primary/30 transition-all cursor-default">
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-brand-primary shadow-sm font-bold text-xs">
                {i + 1}
              </div>
              <p className="text-xs font-bold text-dark-navy tracking-tight leading-tight">{competency}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-24 px-4 bg-warm-cream">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-20 items-center">
            <div>
              <h2 className="text-4xl font-bold text-dark-navy mb-8 tracking-tight">Automating Assessment</h2>
              <div className="space-y-8">
                {[
                  { title: "Strand-based Grading", desc: "Built-in templates for all KICD strands and sub-strands for Junior School and Primary.", icon: Target },
                  { title: "Rubric Scoring (EE/ME/AE/BE)", desc: "No more arbitrary marks. Grade based on performance levels with one-click rubric selection.", icon: ShieldCheck },
                  { title: "Digital Portfolios", desc: "Store evidence of learning — photos, projects, and comments — all tied to student records.", icon: PieChart },
                ].map((feature, i) => (
                  <div key={i} className="flex gap-6 group">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-brand-primary shadow-sm border border-brand-border group-hover:bg-brand-primary group-hover:text-white transition-all shrink-0">
                      <feature.icon size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-dark-navy text-xl mb-1 tracking-tight">{feature.title}</h4>
                      <p className="text-muted-text font-normal leading-relaxed">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="ds-card aspect-[4/3] bg-white p-12 border-brand-border shadow-2xl flex items-center justify-center text-center italic text-muted-text/30 font-medium">
              <div className="w-full space-y-4">
                <div className="h-4 bg-page-bg rounded-full w-full"></div>
                <div className="h-4 bg-teal-accent rounded-full w-3/4"></div>
                <div className="h-4 bg-brand-primary/20 rounded-full w-1/2"></div>
                <div className="h-4 bg-page-bg rounded-full w-5/6"></div>
                <p className="text-xs mt-8">CBC Assessment Grid Preview</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white text-center">
        <h2 className="text-4xl font-bold text-dark-navy mb-8 tracking-tight">Ready to digitize your CBC assessments?</h2>
        <p className="text-muted-text text-lg mb-12 font-normal max-w-2xl mx-auto leading-relaxed">
          Join 40+ Kenyan private schools using ShuleHQ to simplify CBC grading and learner tracking.
        </p>
        <Link href="/demo" className="btn-primary px-12 py-5 text-xl shadow-2xl shadow-brand-primary/20">
          Book a Free Demo
        </Link>
      </section>
    </div>
  );
}
