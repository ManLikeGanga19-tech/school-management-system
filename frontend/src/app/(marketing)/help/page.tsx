import { Search, Book, Video, MessageCircle, FileText, ChevronRight } from "lucide-react";

function RocketIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-5c1.62-2.2 5-3 5-3" />
      <path d="M12 15v5s3.03-.55 5-2c2.2-1.62 3-5 3-5" />
    </svg>
  );
}

const categories = [
  { title: "Getting Started", desc: "Setting up your school profile and importing your first student list.", count: 0, iconType: "rocket" },
  { title: "CBC Grading", desc: "How to enter assessments, manage sub-strands, and print report cards.", count: 0, iconType: "book" },
  { title: "Finance & M-Pesa", desc: "Reconciling bank slips, managing Paybills, and tracking fee balances.", count: 0, iconType: "file" },
  { title: "Parent Communication", desc: "Managing the parent portal, sending bulk SMS, and noticeboards.", count: 0, iconType: "message" },
];

function CategoryIcon({ type, size }: { type: string; size: number }) {
  if (type === "rocket") return <RocketIcon size={size} />;
  if (type === "book") return <Book size={size} />;
  if (type === "file") return <FileText size={size} />;
  return <MessageCircle size={size} />;
}

export default function HelpPage() {
  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-20 bg-dark-navy text-white text-center border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4">
          <span className="label-caps text-brand-primary mb-6 block">Resources</span>
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight mb-8 leading-tight">
            How can we <span className="text-brand-primary italic">help you?</span>
          </h1>
          <div className="max-w-2xl mx-auto relative group">
            <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-muted-text/50 group-focus-within:text-brand-primary transition-colors" size={24} />
            <input
              type="text"
              placeholder="Search guides (e.g. 'How to print report cards'...)"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-6 pl-16 pr-8 text-xl font-bold text-white focus:bg-white focus:text-dark-navy focus:outline-none focus:ring-4 focus:ring-brand-primary/20 transition-all placeholder:text-warm-cream/20"
            />
          </div>
        </div>
      </section>

      <section className="py-12 px-4 bg-white border-b border-brand-border">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-center gap-8 md:gap-16">
          <a href="mailto:support@shulehq.co.ke" className="flex items-center gap-3 text-dark-navy font-bold hover:text-brand-primary transition-colors tracking-tight">
            <Video size={20} className="text-brand-primary" /> Request Video Walkthrough
          </a>
          <a href="mailto:support@shulehq.co.ke?subject=User%20Manual%20Request" className="flex items-center gap-3 text-dark-navy font-bold hover:text-brand-primary transition-colors tracking-tight">
            <FileText size={20} className="text-brand-primary" /> Request User Manual (PDF)
          </a>
          <a href="https://wa.me/254785640048" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-dark-navy font-bold hover:text-brand-primary transition-colors tracking-tight">
            <MessageCircle size={20} className="text-brand-primary" /> WhatsApp Support
          </a>
        </div>
      </section>

      <section className="py-24 px-4">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-8">
          {categories.map((cat, i) => (
            <div key={i} className="ds-card p-10 bg-white border-brand-border hover:border-brand-primary/30 hover:shadow-xl transition-all group flex gap-8 cursor-pointer">
              <div className="w-16 h-16 bg-muted-warm rounded-2xl flex items-center justify-center text-dark-navy group-hover:bg-brand-primary group-hover:text-white transition-all shadow-sm shrink-0 border border-brand-border">
                <CategoryIcon type={cat.iconType} size={32} />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-2xl font-bold text-dark-navy tracking-tight">{cat.title}</h3>
                  {cat.count > 0 && <span className="text-[10px] font-black text-muted-text/40 bg-page-bg px-2 py-1 rounded-lg uppercase tracking-widest">{cat.count} articles</span>}
                </div>
                <p className="text-muted-text leading-relaxed font-normal mb-6">{cat.desc}</p>
                <span className="flex items-center gap-2 text-brand-primary font-bold label-caps group-hover:translate-x-2 transition-transform">
                  Browse {cat.title} <ChevronRight size={16} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="py-24 px-4 bg-warm-cream">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-dark-navy text-center mb-16 tracking-tight">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {[
              { q: "How do I reset my staff password?", a: "Go to Staff Directory → Selected Staff → Security → Reset Password. They will receive an SMS with a temporary link." },
              { q: "Can I use ShuleHQ without internet?", a: "ShuleHQ is a cloud-first platform for data integrity. However, our mobile app allows basic attendance marking offline which syncs when you reconnect." },
              { q: "Does the system support multiple campuses?", a: "Yes, our Enterprise plan allows for a single Director dashboard that consolidates metrics across multiple school locations." },
            ].map((faq, i) => (
              <div key={i} className="ds-card bg-white p-8 border-brand-border shadow-sm">
                <h4 className="text-lg font-bold text-dark-navy mb-4 tracking-tight">{faq.q}</h4>
                <p className="text-muted-text font-normal leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white text-center">
        <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight">Still stuck?</h2>
        <p className="text-muted-text text-lg mb-10 font-normal">Our support team is available Mon–Fri, 8am–5pm.</p>
        <div className="flex flex-col sm:flex-row justify-center gap-6">
          <a href="mailto:support@shulehq.co.ke" className="btn-primary px-10 py-5 text-lg">Email Support</a>
          <a href="https://wa.me/254785640048" target="_blank" rel="noopener noreferrer" className="btn-secondary px-10 py-5 text-lg">WhatsApp +254 785 640 048</a>
        </div>
      </section>
    </div>
  );
}
