import Link from "next/link";
import { Users, User, Target, Award, MapPin, ShieldCheck, ArrowRight, TrendingUp, Heart } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="bg-page-bg">
      <section className="pt-32 pb-20 bg-hero-gradient border-b border-brand-border">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <span className="ds-badge bg-light-sand text-deep-teal mb-8">Our Mission</span>
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold text-dark-navy tracking-tight mb-8 leading-[1.1]">
            Empowering Kenyan Schools through <br className="hidden md:block" />{" "}
            <span className="text-brand-primary italic">Intelligent Automation</span>
          </h1>
          <p className="max-w-3xl mx-auto text-xl text-muted-text mb-12 leading-relaxed font-normal">
            ShuleHQ started with a simple observation: Educators in Kenya were spending more time on paperwork than on pupils. We built a platform to change that.
          </p>
          <div className="flex justify-center flex-wrap gap-4">
            <div className="px-6 py-3 bg-white rounded-xl border border-brand-border text-sm font-bold text-dark-navy flex items-center gap-2 shadow-sm">
              <MapPin size={16} className="text-brand-primary" /> Headquartered in Nairobi
            </div>
            <div className="px-6 py-3 bg-white rounded-xl border border-brand-border text-sm font-bold text-dark-navy flex items-center gap-2 shadow-sm">
              <ShieldCheck size={16} className="text-brand-primary" /> 100% Kenyan Owned
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-20 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-dark-navy mb-8 tracking-tight">The ShuleHQ Journey</h2>
              <div className="space-y-6 text-muted-text text-lg leading-relaxed font-normal">
                <p>In 2022, as the Ministry of Education rolled out the Competency-Based Curriculum (CBC), we saw private school directors struggling to keep up with the new assessment standards using old tools.</p>
                <p>Most existing school management systems were built for Western markets and then "localized." They didn't understand what EE/ME/AE/BE meant. They didn't understand the nuance of M-Pesa fee reconciliation in rural or peri-urban settings.</p>
                <p>We gathered a team of Kenyan educators, bursars, and software engineers to build something different: A system built <span className="text-brand-primary font-bold underline decoration-brand-primary/30">ground-up</span> for Kenya.</p>
              </div>
              <div className="mt-12 grid grid-cols-2 gap-8">
                <div>
                  <p className="text-4xl font-bold text-dark-navy mb-2 tracking-tight">40+</p>
                  <p className="label-caps text-muted-text">Active Schools</p>
                </div>
                <div>
                  <p className="text-4xl font-bold text-dark-navy mb-2 tracking-tight">12k+</p>
                  <p className="label-caps text-muted-text">Registered Students</p>
                </div>
              </div>
            </div>
            <div className="relative group">
              <div className="absolute -inset-4 bg-brand-primary/5 rounded-[2.5rem] blur-2xl opacity-50 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative ds-card aspect-[4/5] bg-muted-warm flex items-center justify-center p-12 text-muted-text italic text-center font-medium border border-brand-border overflow-hidden">
                <div className="flex flex-col items-center gap-6">
                  <TrendingUp size={48} className="opacity-20 text-brand-primary" />
                  <p className="text-sm font-medium">[Photo: The ShuleHQ team with a school director in Nairobi]</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-dark-gradient text-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-bold mb-4 tracking-tight">Our Core Principles</h2>
            <p className="text-warm-cream/60 max-w-xl mx-auto font-normal">These values guide every button we build and every feature we release.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Target, title: "CBC-First Design", desc: "We don't just 'add' CBC features. We build everything around the curriculum's philosophy of continuous assessment." },
              { icon: Heart, title: "Educator Empathy", desc: "We spend hours in real school offices listening to bursars and teachers before we write a single line of code." },
              { icon: Award, title: "Uncompromising Security", desc: "Child data protection is our highest priority. We use industry-leading encryption for every student record." },
            ].map((value, i) => (
              <div key={i} className="bg-white/5 border border-white/10 p-10 rounded-[2rem] hover:bg-white/10 transition-all group backdrop-blur-sm">
                <div className="w-14 h-14 bg-brand-primary rounded-xl flex items-center justify-center text-white mb-8 group-hover:scale-110 transition-transform shadow-lg">
                  <value.icon size={28} />
                </div>
                <h3 className="text-2xl font-bold mb-4 tracking-tight">{value.title}</h3>
                <p className="text-warm-cream/70 leading-relaxed font-normal">{value.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-warm-cream">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
            <div className="max-w-2xl">
              <span className="label-caps text-brand-primary mb-4 block">Our Team</span>
              <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight">Led by innovators</h2>
              <p className="text-muted-text text-lg font-normal leading-relaxed">Our leadership team combines decades of experience in Kenyan education and global software engineering.</p>
            </div>
            <Link href="/careers" className="btn-secondary flex items-center gap-2">
              View Careers <Users size={18} />
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { name: "Faith Wambui", role: "CEO & Co-founder", desc: "Former School Director" },
              { name: "Daniel Orwenjo", role: "CTO & Co-founder", desc: "Software Engineer" },
              { name: "Johnstone Makau", role: "Head of Support", desc: "Ex-Ministry Educator" },
              { name: "Sarah Nyambura", role: "Product Designer", desc: "Fintech Expert" },
            ].map((member, i) => (
              <div key={i} className="group">
                <div className="ds-card aspect-square mb-6 border-brand-border bg-page-bg overflow-hidden flex items-center justify-center italic text-muted-text font-medium group-hover:bg-white transition-all shadow-sm">
                  <div className="text-center p-4">
                    <User size={40} className="mx-auto mb-2 opacity-10" />
                    <span className="text-xs">[Photo: {member.name}]</span>
                  </div>
                </div>
                <h4 className="text-xl font-bold text-dark-navy tracking-tight">{member.name}</h4>
                <p className="text-brand-primary label-caps mt-1">{member.role}</p>
                <p className="text-muted-text text-sm font-normal mt-2">{member.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-7xl mx-auto bg-dark-navy rounded-[3rem] p-12 md:p-24 text-white text-center shadow-2xl relative overflow-hidden border border-white/5">
          <h2 className="text-4xl md:text-5xl font-bold mb-8 relative z-10 tracking-tight leading-tight">
            Ready to see how we can <br /> transform your school?
          </h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 relative z-10">
            <Link href="/demo" className="btn-dark-section text-xl px-12 py-5 shadow-2xl">Request a Free Demo</Link>
            <Link href="/pricing" className="text-warm-cream/60 hover:text-white font-bold flex items-center gap-2 group transition-colors">
              View Pricing Plans <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
