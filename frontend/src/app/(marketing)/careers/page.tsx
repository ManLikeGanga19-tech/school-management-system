import { Briefcase, MapPin, Clock, ArrowRight, Star } from "lucide-react";

const jobs = [
  { id: 1, title: "Senior Fullstack Engineer", team: "Product", location: "Nairobi (Hybrid)", type: "Full-time" },
  { id: 2, title: "Customer Success Manager", team: "Operations", location: "Remote / Field", type: "Full-time" },
  { id: 3, title: "CBC Pedagogical Specialist", team: "Curriculum", location: "Nairobi", type: "Contract" },
  { id: 4, title: "Sales Lead (Private Schools)", team: "Growth", location: "Nairobi", type: "Full-time" },
];

export default function CareersPage() {
  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-20 bg-dark-navy text-white text-center border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4">
          <span className="label-caps text-brand-primary mb-6 block">Join the Team</span>
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight mb-8 leading-tight">
            Help us build the future <br className="hidden md:block" /> of{" "}
            <span className="text-brand-primary italic">Kenyan Education</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-warm-cream/60 leading-relaxed font-normal">
            We're a mission-driven team of educators and engineers building the backbone of digital administration for schools across Kenya.
          </p>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-12">
            {[
              { title: "Impact First", desc: "Every line of code you write directly helps a school director save hours of paperwork, letting them focus on pupils.", icon: Star },
              { title: "Local Excellence", desc: "We are proud to be building Kenyan solutions for Kenyan challenges. No 'localized' Western templates here.", icon: Briefcase },
              { title: "Growth Mindset", desc: "We move fast, we learn fast. You'll have the autonomy to own your work and grow your skills exponentially.", icon: Clock },
            ].map((benefit, i) => (
              <div key={i} className="group">
                <div className="w-12 h-12 bg-teal-accent text-deep-teal rounded-xl flex items-center justify-center mb-6 group-hover:bg-brand-primary group-hover:text-white transition-all shadow-sm">
                  <benefit.icon size={24} />
                </div>
                <h3 className="text-xl font-bold text-dark-navy mb-4 tracking-tight">{benefit.title}</h3>
                <p className="text-muted-text leading-relaxed font-normal">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-page-bg">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-6">
            <div>
              <h2 className="text-4xl font-bold text-dark-navy mb-4 tracking-tight">Open Positions</h2>
              <p className="text-muted-text text-lg font-normal">
                Don't see a fit? Reach out at <span className="text-brand-primary font-bold">careers@shulehq.co.ke</span>
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            {jobs.map((job) => (
              <div key={job.id} className="ds-card bg-white p-8 flex flex-col md:flex-row md:items-center justify-between hover:border-brand-primary/30 hover:shadow-lg transition-all group cursor-pointer border-brand-border">
                <div className="mb-4 md:mb-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="ds-badge bg-teal-accent text-deep-teal">{job.team}</span>
                    <span className="label-caps text-muted-text text-[10px]">{job.type}</span>
                  </div>
                  <h3 className="text-xl font-bold text-dark-navy group-hover:text-brand-primary transition-colors tracking-tight">{job.title}</h3>
                </div>
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-2 text-muted-text font-bold label-caps">
                    <MapPin size={16} className="text-brand-primary" /> {job.location}
                  </div>
                  <div className="w-10 h-10 rounded-full bg-muted-warm flex items-center justify-center text-dark-navy group-hover:bg-brand-primary group-hover:text-white transition-all">
                    <ArrowRight size={18} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-7xl mx-auto bg-dark-navy rounded-[3rem] p-12 md:p-20 text-white text-center shadow-2xl relative overflow-hidden">
          <h2 className="text-4xl font-bold mb-8 relative z-10 tracking-tight">Don't see your role?</h2>
          <p className="text-warm-cream/60 text-lg mb-12 relative z-10 font-normal">
            We are always looking for smart, ambitious people who care about education in Kenya.
          </p>
          <a
            href="mailto:careers@shulehq.co.ke?subject=Open%20Application%20%E2%80%94%20ShuleHQ&body=Hi%20ShuleHQ%20team%2C%0A%0AName%3A%20%0ARole%20interested%20in%3A%20%0ALinkedIn%20%2F%20Portfolio%3A%20%0A%0AWhy%20I%20want%20to%20join%20ShuleHQ%3A%0A"
            className="btn-dark-section px-12 py-5 text-xl relative z-10"
          >
            Send an Open Application
          </a>
        </div>
      </section>
    </div>
  );
}
